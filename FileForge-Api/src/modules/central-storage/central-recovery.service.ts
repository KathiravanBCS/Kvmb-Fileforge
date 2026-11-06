import { randomUUID } from 'node:crypto';

import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import type { central_files, Prisma } from '../../../generated/prisma/client';
import { describeError } from '../../common/utils/logging.util';
import { recoveryConfig } from '../../config/central-hardening.config';
import { PrismaService } from '../../prisma/prisma.service';
import type { GraphDriveItem } from '../storage/onedrive/onedrive.types';
import { CentralStorageAuditService } from './central-storage-audit.service';
import { CentralStorageOneDriveService } from './central-storage-onedrive.service';
import { ENTITY_CENTRAL_FILE, FILE_STATUS } from './central-storage.constants';
import type { Actor } from './types/central-storage.types';

export type RecoveryOutcome = 'repaired' | 'retry_scheduled' | 'needs_review' | 'reauth_required' | 'no_action';

/** Reasons a file is handed to an administrator (stored in review_reason, shown on the recovery page). */
export const REVIEW_REASON = {
  orphanItem: 'orphan_onedrive_item',
  sizeMismatch: 'size_mismatch',
  unexpectedItem: 'unexpected_item_type',
  driveMismatch: 'drive_mismatch',
  itemMissing: 'item_missing',
  replaceMismatch: 'replace_content_mismatch',
  replaceUnknown: 'replace_state_unknown',
  attemptsExhausted: 'max_attempts_exceeded',
} as const;

/** Statuses that mean "an operation did not finish" (or, for `failed`, "check nothing was left behind"). */
export const INTERRUPTED_STATUSES: string[] = [
  FILE_STATUS.pending,
  FILE_STATUS.uploading,
  FILE_STATUS.replacing,
  FILE_STATUS.deleting,
];
export const RECOVERABLE_STATUSES: string[] = [...INTERRUPTED_STATUSES, FILE_STATUS.failed];

const REAUTH_RETRY_MS = 15 * 60_000;
const BACKOFF_BASE_MS = 2 * 60_000;
const BACKOFF_MAX_MS = 6 * 60 * 60_000;
const NOT_CONNECTED_CODES = new Set(['CENTRAL_STORAGE_NOT_CONNECTED', 'CENTRAL_STORAGE_RECONNECT_REQUIRED']);

/** Thrown when this worker no longer owns the file (its lease ran out, or someone changed the file): stop, write nothing more. */
class LeaseLostError extends Error {
  constructor() {
    super('recovery lease lost');
  }
}

interface Claim {
  row: central_files;
  token: string;
}

type Decision =
  | { kind: 'repair'; toStatus: string; data: Prisma.central_filesUpdateManyMutationInput; note: string }
  | { kind: 'review'; reason: string }
  | { kind: 'nothing' };

export interface RecoverySummary {
  examined: number;
  outcomes: Partial<Record<RecoveryOutcome | 'lease_lost', number>>;
}

/** Delay before attempt n+1 (n >= 1 failed attempts so far): 2, 4, 8 ... minutes, at most 6 hours. */
export function backoffMs(failedAttempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, failedAttempts - 1), BACKOFF_MAX_MS);
}

/**
 * Reconciles files whose operation was interrupted (a backend crash, a restart, a lost database connection) so PostgreSQL and
 * OneDrive agree again. Nothing here guesses: every decision comes from what OneDrive actually holds at the file's own,
 * server-generated path, compared with what PostgreSQL recorded BEFORE the operation started (size, checksum, eTag).
 *
 * What it does:
 *  - `uploading`: the item exists with the expected size -> record it (`ready`); it does not exist -> `failed`; any other
 *    size -> an administrator decides.
 *  - `replacing`: the item still has the recorded eTag -> the replacement never landed, restore `ready`; the eTag changed
 *    and the size is the pending size -> it landed, record it; anything else -> an administrator decides.
 *  - `deleting`: finish the delete the owner or administrator already asked for (the row has been hidden since then).
 *  - `failed`: look for an item that was left behind. NEVER deleted: a `failed` row is not proof that the item is garbage
 *    (e.g. the compensating delete failed while the bytes are fine). It is flagged for an administrator.
 *
 * LOCKING: a row is owned through a lease (token + expiry, in the row itself, judged by the DATABASE clock). It is renewed
 * before every OneDrive call, and every write the worker makes carries the token and "lease not expired" and "status still
 * what it was" in its WHERE clause. A worker that stalls past its lease therefore cannot write; another instance takes over;
 * a user operation that changes the file in the meantime makes the worker's final write a no-op. This is correct on any number
 * of backend instances, with no connection held open.
 */
@Injectable()
export class CentralRecoveryService {
  private readonly logger = new Logger(CentralRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: CentralStorageOneDriveService,
    private readonly audit: CentralStorageAuditService,
    @Inject(recoveryConfig.KEY) private readonly config: ConfigType<typeof recoveryConfig>,
  ) {}

  /** One pass: recover the files that are due, one at a time (so a lease is never waiting behind a slow neighbour). */
  async runOnce(isStopping: () => boolean = () => false): Promise<RecoverySummary> {
    const now = await this.databaseNow();
    const due = this.dueWhere(now);
    const candidates = await this.prisma.central_files.findMany({
      where: due,
      orderBy: [{ next_recovery_at: 'asc' }, { id: 'asc' }],
      take: this.config.batchSize * 3, // some will be taken by other instances first
      select: { id: true },
    });

    const summary: RecoverySummary = { examined: 0, outcomes: {} };
    for (const { id } of candidates) {
      if (summary.examined >= this.config.batchSize || isStopping()) break;
      const claim = await this.claim(id, due);
      if (!claim) continue;
      const outcome = await this.recover(claim);
      summary.examined += 1;
      summary.outcomes[outcome] = (summary.outcomes[outcome] ?? 0) + 1;
    }
    return summary;
  }

  /**
   * An administrator asked for this file to be recovered NOW (regardless of schedule or an earlier "needs review").
   * 'busy' = another worker is on it right now; 'not_recoverable' = nothing to recover (ready, deleted, or unknown).
   */
  async recoverNow(id: bigint, actor: Actor): Promise<RecoveryOutcome | 'lease_lost' | 'busy' | 'not_recoverable'> {
    const claim = await this.claim(
      id,
      { upload_status: { in: RECOVERABLE_STATUSES } },
      {
        needs_review: false,
        review_reason: null,
        recovery_attempts: 0,
      },
    );
    if (!claim) {
      const row = await this.prisma.central_files.findFirst({ where: { id }, select: { upload_status: true } });
      return row && RECOVERABLE_STATUSES.includes(row.upload_status) ? 'busy' : 'not_recoverable';
    }
    return this.recover(claim, actor);
  }

  // ----- selection and leases --------------------------------------------------------------------------------------

  /** Files that need a look: interrupted or failed, not parked for a human, and either scheduled or untouched for a long time. */
  dueWhere(now: Date): Prisma.central_filesWhereInput {
    const stale = new Date(now.getTime() - this.config.staleMs);
    return {
      upload_status: { in: RECOVERABLE_STATUSES },
      needs_review: false,
      OR: [
        { next_recovery_at: { lte: now } },
        {
          next_recovery_at: null,
          last_recovery_at: null,
          OR: [{ updated_at: { lt: stale } }, { updated_at: null, created_at: { lt: stale } }],
        },
      ],
    };
  }

  /**
   * Takes the file's lease with ONE conditional UPDATE: of any number of instances trying at once, exactly one gets
   * count = 1. If the holder dies, the file is due again the moment the lease expires (next_recovery_at = lease end).
   */
  private async claim(
    id: bigint,
    where: Prisma.central_filesWhereInput,
    extra: Prisma.central_filesUpdateManyMutationInput = {},
  ): Promise<Claim | null> {
    const now = await this.databaseNow();
    const token = randomUUID();
    const until = new Date(now.getTime() + this.config.leaseMs);
    const claimed = await this.prisma.central_files.updateMany({
      where: {
        AND: [{ id }, where, { OR: [{ recovery_lease_until: null }, { recovery_lease_until: { lte: now } }] }],
      },
      data: { recovery_lease_token: token, recovery_lease_until: until, next_recovery_at: until, ...extra },
    });
    if (claimed.count !== 1) return null;
    const row = await this.prisma.central_files.findFirst({ where: { id, recovery_lease_token: token } });
    return row ? { row, token } : null;
  }

  /** Extends the lease. Called before every OneDrive call; if the lease is gone, the worker stops. */
  private async renew(claim: Claim): Promise<void> {
    const now = await this.databaseNow();
    const renewed = await this.prisma.central_files.updateMany({
      where: { id: claim.row.id, recovery_lease_token: claim.token, recovery_lease_until: { gt: now } },
      data: { recovery_lease_until: new Date(now.getTime() + this.config.leaseMs) },
    });
    if (renewed.count !== 1) throw new LeaseLostError();
  }

  /** The worker's only way to write the result: valid lease + file still in the status it was examined in. Releases the lease. */
  private async settle(
    claim: Claim,
    outcome: RecoveryOutcome,
    data: Prisma.central_filesUpdateManyMutationInput,
    nextRecoveryAt: Date | null,
  ): Promise<void> {
    const now = await this.databaseNow();
    const written = await this.prisma.central_files.updateMany({
      where: {
        id: claim.row.id,
        recovery_lease_token: claim.token,
        recovery_lease_until: { gt: now },
        upload_status: claim.row.upload_status,
      },
      data: {
        ...data,
        last_recovery_at: now,
        last_recovery_outcome: outcome,
        next_recovery_at: nextRecoveryAt,
        recovery_lease_token: null,
        recovery_lease_until: null,
      },
    });
    if (written.count !== 1) throw new LeaseLostError();
  }

  // ----- one file --------------------------------------------------------------------------------------------------

  private async recover(claim: Claim, actor?: Actor): Promise<RecoveryOutcome | 'lease_lost'> {
    const { row } = claim;
    try {
      await this.renew(claim);
      const decision = await this.decide(claim);
      return await this.apply(claim, decision, actor);
    } catch (error) {
      if (error instanceof LeaseLostError) {
        this.logger.warn({
          event: 'central_recovery_lease_lost',
          fileId: row.id.toString(),
          status: row.upload_status,
        });
        return 'lease_lost';
      }
      return this.handleFailure(claim, error, actor);
    }
  }

  private async decide(claim: Claim): Promise<Decision> {
    const { row } = claim;
    const connection = await this.storage.usableConnection();
    if (row.external_drive_id !== connection.driveId) return { kind: 'review', reason: REVIEW_REASON.driveMismatch };

    switch (row.upload_status) {
      case FILE_STATUS.pending:
      case FILE_STATUS.uploading:
        return this.decideUpload(claim);
      case FILE_STATUS.replacing:
        return this.decideReplace(claim);
      case FILE_STATUS.deleting:
        return this.decideDelete(claim);
      case FILE_STATUS.failed:
        return this.decideFailed(claim);
      default:
        return { kind: 'nothing' };
    }
  }

  private async decideUpload(claim: Claim): Promise<Decision> {
    const { row } = claim;
    await this.renew(claim);
    const item = await this.storage.findUserFile(row.owner_user_id, row.stored_name);
    const now = await this.databaseNow();
    if (!item) {
      // The upload never completed (OneDrive only creates the item when the last byte lands): nothing to keep.
      return {
        kind: 'repair',
        toStatus: FILE_STATUS.failed,
        note: 'upload_interrupted',
        data: {
          upload_status: FILE_STATUS.failed,
          is_deleted: true,
          deleted_at: now,
          last_error_code: 'UPLOAD_INTERRUPTED',
        },
      };
    }
    if (item.folder) return { kind: 'review', reason: REVIEW_REASON.unexpectedItem };
    if (item.size !== Number(row.size_bytes)) return { kind: 'review', reason: REVIEW_REASON.sizeMismatch };
    return {
      kind: 'repair',
      toStatus: FILE_STATUS.ready,
      note: 'upload_recorded',
      data: {
        upload_status: FILE_STATUS.ready,
        uploaded_at: now,
        external_item_id: item.id,
        ...itemFields(item),
        external_created_at: item.createdDateTime ? new Date(item.createdDateTime) : null,
        size_bytes: BigInt(item.size ?? Number(row.size_bytes)),
        last_error_code: null,
      },
    };
  }

  private async decideReplace(claim: Claim): Promise<Decision> {
    const { row } = claim;
    if (!row.external_item_id) return { kind: 'review', reason: REVIEW_REASON.itemMissing };
    await this.renew(claim);
    const item = await this.storage.findItem(row.external_item_id);
    if (!item) return { kind: 'review', reason: REVIEW_REASON.itemMissing };
    if (item.folder) return { kind: 'review', reason: REVIEW_REASON.unexpectedItem };

    const etagKnown = row.external_etag !== null;
    if (etagKnown && item.eTag === row.external_etag) {
      // Same version as before the replacement started: the new content never landed, the old content is intact.
      return {
        kind: 'repair',
        toStatus: FILE_STATUS.ready,
        note: 'replace_not_applied',
        data: {
          upload_status: FILE_STATUS.ready,
          last_error_code: 'REPLACE_INTERRUPTED',
          pending_size_bytes: null,
          pending_checksum_sha256: null,
        },
      };
    }
    const pending = row.pending_size_bytes === null ? null : Number(row.pending_size_bytes);
    if (pending !== null && item.size === pending) {
      const now = await this.databaseNow();
      return {
        kind: 'repair',
        toStatus: FILE_STATUS.ready,
        note: 'replace_recorded',
        data: {
          upload_status: FILE_STATUS.ready,
          size_bytes: BigInt(pending),
          checksum_sha256: row.pending_checksum_sha256,
          content_version: { increment: 1 },
          ...itemFields(item),
          uploaded_at: now,
          last_error_code: null,
          pending_size_bytes: null,
          pending_checksum_sha256: null,
        },
      };
    }
    return { kind: 'review', reason: etagKnown ? REVIEW_REASON.replaceMismatch : REVIEW_REASON.replaceUnknown };
  }

  private async decideDelete(claim: Claim): Promise<Decision> {
    const { row } = claim;
    const done: Decision = {
      kind: 'repair',
      toStatus: FILE_STATUS.deleted,
      note: 'delete_completed',
      data: { upload_status: FILE_STATUS.deleted, last_error_code: null },
    };
    if (!row.external_item_id) return done;
    await this.renew(claim);
    // findItem also refuses anything outside FileForge-Central, so a damaged item id can never delete something else.
    const item = await this.storage.findItem(row.external_item_id);
    if (item) {
      await this.renew(claim);
      await this.storage.deleteItem(row.external_item_id);
    }
    return done;
  }

  private async decideFailed(claim: Claim): Promise<Decision> {
    const { row } = claim;
    await this.renew(claim);
    const item = await this.storage.findUserFile(row.owner_user_id, row.stored_name);
    // Left behind in OneDrive. NOT deleted automatically: "failed" in the database does not prove the bytes are garbage.
    return item ? { kind: 'review', reason: REVIEW_REASON.orphanItem } : { kind: 'nothing' };
  }

  // ----- results ---------------------------------------------------------------------------------------------------

  private async apply(claim: Claim, decision: Decision, actor?: Actor): Promise<RecoveryOutcome> {
    const { row } = claim;
    switch (decision.kind) {
      case 'repair':
        await this.settle(claim, 'repaired', { ...decision.data, ...CLEAR_REVIEW }, null);
        await this.record(claim, 'repaired', { toStatus: decision.toStatus, note: decision.note }, actor);
        return 'repaired';
      case 'review':
        await this.settle(claim, 'needs_review', { needs_review: true, review_reason: decision.reason }, null);
        await this.record(claim, 'needs_review', { reason: decision.reason }, actor);
        return 'needs_review';
      case 'nothing':
        await this.settle(claim, 'no_action', {}, null);
        this.logger.log({ event: 'central_recovery_no_action', fileId: row.id.toString(), status: row.upload_status });
        return 'no_action';
    }
  }

  /** A failed attempt: wait for the connection, or retry with a growing delay, or hand it to an administrator. */
  private async handleFailure(claim: Claim, error: unknown, actor?: Actor): Promise<RecoveryOutcome | 'lease_lost'> {
    const { row } = claim;
    const code = codeOf(error);
    this.logger.warn({
      event: 'central_recovery_attempt_failed',
      fileId: row.id.toString(),
      status: row.upload_status,
      code,
      error: describeError(error),
    });
    try {
      const now = await this.databaseNow();
      if (NOT_CONNECTED_CODES.has(code)) {
        // Not this file's fault, and nothing an attempt can fix: wait for the administrator to reconnect. Not counted.
        await this.settle(claim, 'reauth_required', {}, new Date(now.getTime() + REAUTH_RETRY_MS));
        return 'reauth_required';
      }
      const attempts = row.recovery_attempts + 1;
      if (attempts >= this.config.maxAttempts) {
        await this.settle(
          claim,
          'needs_review',
          { recovery_attempts: attempts, needs_review: true, review_reason: REVIEW_REASON.attemptsExhausted },
          null,
        );
        await this.record(claim, 'needs_review', { reason: REVIEW_REASON.attemptsExhausted, code }, actor);
        return 'needs_review';
      }
      await this.settle(
        claim,
        'retry_scheduled',
        { recovery_attempts: attempts },
        new Date(now.getTime() + backoffMs(attempts)),
      );
      return 'retry_scheduled';
    } catch (settleError) {
      if (settleError instanceof LeaseLostError) return 'lease_lost';
      // The database itself is failing. The lease expires on its own and the file becomes due again.
      this.logger.error({
        event: 'central_recovery_settle_failed',
        fileId: row.id.toString(),
        error: describeError(settleError),
      });
      return 'retry_scheduled';
    }
  }

  /** Audit trail of what recovery changed. A failure to write it never undoes the repair. */
  private async record(
    claim: Claim,
    outcome: RecoveryOutcome,
    extra: Record<string, string>,
    actor?: Actor,
  ): Promise<void> {
    const { row } = claim;
    const details = {
      fromStatus: row.upload_status,
      ownerUserId: row.owner_user_id.toString(),
      attempts: row.recovery_attempts,
      ...extra,
    };
    const action = `central_storage.recovery.${outcome}`;
    try {
      if (actor) await this.audit.record(actor, action, { type: ENTITY_CENTRAL_FILE, id: row.id }, details);
      else await this.audit.recordSystem(action, { type: ENTITY_CENTRAL_FILE, id: row.id }, details);
    } catch (error) {
      this.logger.error({
        event: 'central_recovery_audit_failed',
        fileId: row.id.toString(),
        error: describeError(error),
      });
    }
  }

  /** The database's clock, so instances with skewed clocks agree about lease and schedule times. */
  async databaseNow(): Promise<Date> {
    const [row] = await this.prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    if (!row) throw new Error('database clock unavailable');
    return row.now;
  }
}

const CLEAR_REVIEW = { needs_review: false, review_reason: null } as const;

function itemFields(item: GraphDriveItem) {
  return {
    external_etag: item.eTag ?? null,
    external_ctag: item.cTag ?? null,
    external_last_modified_at: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null,
  };
}

function codeOf(error: unknown): string {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (typeof body === 'object' && body !== null && typeof (body as { code?: unknown }).code === 'string') {
      return (body as { code: string }).code.slice(0, 60);
    }
  }
  return 'UNEXPECTED';
}
