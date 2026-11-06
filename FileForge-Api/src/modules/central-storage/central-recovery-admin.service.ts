import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import type { central_files, Prisma } from '../../../generated/prisma/client';
import { recoveryConfig } from '../../config/central-hardening.config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CentralRecoveryService,
  INTERRUPTED_STATUSES,
  RECOVERABLE_STATUSES,
  REVIEW_REASON,
} from './central-recovery.service';
import { CentralStorageAccessService } from './central-storage-access.service';
import { CentralStorageAuditService } from './central-storage-audit.service';
import { fileNotFound } from './central-storage-errors';
import { ENTITY_CENTRAL_FILE } from './central-storage.constants';
import { parseFileId } from './central-storage.service';
import type { RecoveryListQuery } from './dto/central-recovery.dto';
import type { Actor } from './types/central-storage.types';

type State = 'needs_review' | 'retrying' | 'waiting';

export interface RecoveryItemView {
  id: string;
  fileName: string;
  extension: string | null;
  ownerId: string;
  owner: { id: string; displayName: string | null; email: string } | null;
  status: string;
  state: State;
  sizeBytes: number;
  pendingSizeBytes: number | null;
  createdAt: string;
  updatedAt: string | null;
  attempts: number;
  maxAttempts: number;
  nextRecoveryAt: string | null;
  lastRecoveryAt: string | null;
  lastOutcome: string | null;
  reviewReason: string | null;
  lastErrorCode: string | null;
  explanation: string;
  inProgress: boolean;
}

export interface RecoverySummaryView {
  worker: { enabled: boolean; intervalSeconds: number; staleMinutes: number; maxAttempts: number };
  needsReview: number;
  retrying: number;
  waiting: number;
  reauthRequired: number;
  repairedLast24h: number;
  lastRecoveryAt: string | null;
}

export interface RecoveryEventView {
  action: string;
  actorType: string;
  occurredAt: string;
  details: Record<string, unknown>;
}

const DAY_MS = 24 * 60 * 60_000;
const MINUTE_MS = 60_000;
const MAX_EVENTS = 20;

const REVIEW_TEXT: Record<string, string> = {
  [REVIEW_REASON.orphanItem]:
    'The upload is recorded as failed, but a file with its generated name still exists in OneDrive. It was NOT deleted. Check it in OneDrive, then delete it there or mark this as reviewed.',
  [REVIEW_REASON.sizeMismatch]:
    'A file exists in OneDrive but its size differs from what was recorded for the upload. Nothing was changed.',
  [REVIEW_REASON.unexpectedItem]: 'OneDrive holds something other than a file at this location. Nothing was changed.',
  [REVIEW_REASON.driveMismatch]:
    'This file belongs to a different OneDrive than the one connected now (the central account was changed). Nothing was changed.',
  [REVIEW_REASON.itemMissing]: 'The file is no longer in OneDrive (or was never recorded). Nothing was changed.',
  [REVIEW_REASON.replaceMismatch]:
    'The content in OneDrive changed, but it does not match the replacement that was in progress. Nothing was changed.',
  [REVIEW_REASON.replaceUnknown]:
    'A replacement was interrupted and the earlier version of the file was never recorded, so it cannot be verified automatically. Nothing was changed.',
  [REVIEW_REASON.attemptsExhausted]:
    'Automatic recovery tried several times and could not finish. Check that OneDrive is reachable, then retry.',
};

const STATUS_TEXT: Record<string, string> = {
  pending: 'An upload was interrupted. The worker will look in OneDrive for the file and finish or discard it.',
  uploading: 'An upload was interrupted. The worker will look in OneDrive for the file and finish or discard it.',
  replacing:
    'A replacement was interrupted. The worker will check whether the new content reached OneDrive and either record it or keep the old content.',
  deleting: 'A delete was interrupted. The worker will finish removing the file from OneDrive.',
  failed:
    'The upload failed. The worker will check that nothing was left behind in OneDrive (it never deletes anything there by itself).',
};

/** Plain-language account of one row, for the recovery page. Built only from the row's own fields. */
export function explain(row: central_files, maxAttempts: number): string {
  if (row.needs_review) {
    return REVIEW_TEXT[row.review_reason ?? ''] ?? 'An administrator needs to look at this file. Nothing was changed.';
  }
  if (row.last_recovery_outcome === 'reauth_required') {
    return 'Waiting for the central OneDrive to be reconnected. It will be tried again automatically.';
  }
  if (row.recovery_attempts > 0) {
    return `Tried ${row.recovery_attempts} of ${maxAttempts} times; the next attempt is scheduled. ${STATUS_TEXT[row.upload_status] ?? ''}`.trim();
  }
  return STATUS_TEXT[row.upload_status] ?? 'This file is waiting to be examined.';
}

/** The administrator side of recovery: what needs attention, why, and the two things an administrator can do about it. */
@Injectable()
export class CentralRecoveryAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recovery: CentralRecoveryService,
    private readonly access: CentralStorageAccessService,
    private readonly audit: CentralStorageAuditService,
    @Inject(recoveryConfig.KEY) private readonly config: ConfigType<typeof recoveryConfig>,
  ) {}

  async summary(actor: Actor): Promise<RecoverySummaryView> {
    await this.access.requireSystemAdmin(actor.userId);
    const now = await this.recovery.databaseNow();
    const count = (where: Prisma.central_filesWhereInput) => this.prisma.central_files.count({ where });
    const [needsReview, retrying, waiting, reauthRequired, repairedLast24h, last] = await Promise.all([
      count(this.stateWhere('needs_review', now)),
      count(this.stateWhere('retrying', now)),
      count(this.stateWhere('waiting', now)),
      count({
        upload_status: { in: RECOVERABLE_STATUSES },
        needs_review: false,
        last_recovery_outcome: 'reauth_required',
      }),
      count({ last_recovery_outcome: 'repaired', last_recovery_at: { gt: new Date(now.getTime() - DAY_MS) } }),
      this.prisma.central_files.findFirst({
        where: { last_recovery_at: { not: null } },
        orderBy: { last_recovery_at: 'desc' },
        select: { last_recovery_at: true },
      }),
    ]);
    return {
      worker: {
        enabled: this.config.enabled,
        intervalSeconds: Math.round(this.config.intervalMs / 1000),
        staleMinutes: Math.round(this.config.staleMs / MINUTE_MS),
        maxAttempts: this.config.maxAttempts,
      },
      needsReview,
      retrying,
      waiting,
      reauthRequired,
      repairedLast24h,
      lastRecoveryAt: last?.last_recovery_at?.toISOString() ?? null,
    };
  }

  async list(actor: Actor, query: RecoveryListQuery) {
    await this.access.requireSystemAdmin(actor.userId);
    const now = await this.recovery.databaseNow();
    const where = this.stateWhere(query.state, now);
    const [rows, total] = await Promise.all([
      this.prisma.central_files.findMany({
        where,
        orderBy: [{ needs_review: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.central_files.count({ where }),
    ]);
    return { items: await this.toViews(rows, now), page: query.page, pageSize: query.pageSize, total };
  }

  async detail(actor: Actor, rawId: string) {
    await this.access.requireSystemAdmin(actor.userId);
    const row = await this.findRecoverable(rawId, true);
    const now = await this.recovery.databaseNow();
    return { item: (await this.toViews([row], now))[0], events: await this.events(row.id) };
  }

  /** Recover this file NOW, whatever its schedule or an earlier "needs review" (an explicit administrator action). */
  async retry(actor: Actor, rawId: string) {
    await this.access.requireSystemAdmin(actor.userId);
    const row = await this.findRecoverable(rawId, false);
    // Recorded first: if the trail cannot be written, nothing happens.
    await this.audit.record(
      actor,
      'central_storage.recovery.retry_requested',
      { type: ENTITY_CENTRAL_FILE, id: row.id },
      {
        ownerUserId: row.owner_user_id.toString(),
        status: row.upload_status,
      },
    );
    const outcome = await this.recovery.recoverNow(row.id, actor);
    if (outcome === 'busy') {
      throw new ConflictException({
        code: 'RECOVERY_BUSY',
        message: 'This file is being worked on right now. Try again in a moment.',
      });
    }
    if (outcome === 'not_recoverable') throw fileNotFound();
    const after = await this.prisma.central_files.findFirst({ where: { id: row.id } });
    const now = await this.recovery.databaseNow();
    return { outcome, item: (await this.toViews([after ?? row], now))[0] };
  }

  /** "I have looked at this and accept it as it is": takes the file out of the review queue. Changes nothing in OneDrive. */
  async dismiss(actor: Actor, rawId: string) {
    await this.access.requireSystemAdmin(actor.userId);
    const row = await this.findRecoverable(rawId, true);
    if (!row.needs_review) {
      throw new ConflictException({ code: 'NOT_IN_REVIEW', message: 'This file is not waiting for review.' });
    }
    await this.audit.record(
      actor,
      'central_storage.recovery.dismissed',
      { type: ENTITY_CENTRAL_FILE, id: row.id },
      {
        ownerUserId: row.owner_user_id.toString(),
        status: row.upload_status,
        reason: row.review_reason ?? '',
      },
    );
    const now = await this.recovery.databaseNow();
    const changed = await this.prisma.central_files.updateMany({
      where: {
        id: row.id,
        needs_review: true,
        OR: [{ recovery_lease_until: null }, { recovery_lease_until: { lte: now } }],
      },
      data: {
        needs_review: false,
        review_reason: null,
        last_recovery_outcome: 'no_action',
        last_recovery_at: now,
        next_recovery_at: null,
      },
    });
    if (changed.count !== 1) {
      throw new ConflictException({
        code: 'RECOVERY_BUSY',
        message: 'This file is being worked on right now. Try again in a moment.',
      });
    }
    const after = await this.prisma.central_files.findFirst({ where: { id: row.id } });
    return { outcome: 'no_action', item: (await this.toViews([after ?? row], now))[0] };
  }

  // ----- internals -------------------------------------------------------------------------------------------------

  private async findRecoverable(rawId: string, allowResolved: boolean): Promise<central_files> {
    const row = await this.prisma.central_files.findFirst({ where: { id: parseFileId(rawId) } });
    if (!row) throw fileNotFound();
    if (!allowResolved && !RECOVERABLE_STATUSES.includes(row.upload_status)) {
      throw new ConflictException({ code: 'NOT_RECOVERABLE', message: 'This file has nothing to recover.' });
    }
    return row;
  }

  /** The three queues. Together they are everything that needs attention; a repaired file is in none of them. */
  private stateWhere(state: RecoveryListQuery['state'], now: Date): Prisma.central_filesWhereInput {
    const stale = new Date(now.getTime() - this.config.staleMs);
    const needsReview: Prisma.central_filesWhereInput = { needs_review: true };
    const retrying: Prisma.central_filesWhereInput = {
      needs_review: false,
      upload_status: { in: RECOVERABLE_STATUSES },
      OR: [{ recovery_attempts: { gt: 0 } }, { last_recovery_outcome: 'reauth_required' }],
    };
    const waiting: Prisma.central_filesWhereInput = {
      needs_review: false,
      upload_status: { in: INTERRUPTED_STATUSES },
      recovery_attempts: 0,
      last_recovery_at: null,
      OR: [{ updated_at: { lt: stale } }, { updated_at: null, created_at: { lt: stale } }],
    };
    switch (state) {
      case 'needs_review':
        return needsReview;
      case 'retrying':
        return retrying;
      case 'waiting':
        return waiting;
      default:
        return { OR: [needsReview, retrying, waiting] };
    }
  }

  private async toViews(rows: central_files[], now: Date): Promise<RecoveryItemView[]> {
    const users = rows.length
      ? await this.prisma.users.findMany({
          where: { id: { in: [...new Set(rows.map((row) => row.owner_user_id))] } },
          select: { id: true, email: true, display_name: true },
        })
      : [];
    const owners = new Map(users.map((user) => [user.id, user]));
    return rows.map((row) => {
      const owner = owners.get(row.owner_user_id);
      const state: State = row.needs_review
        ? 'needs_review'
        : row.recovery_attempts > 0 || row.last_recovery_outcome === 'reauth_required'
          ? 'retrying'
          : 'waiting';
      return {
        id: row.id.toString(),
        fileName: row.display_name,
        extension: row.file_extension,
        ownerId: row.owner_user_id.toString(),
        owner: owner ? { id: owner.id.toString(), displayName: owner.display_name, email: owner.email } : null,
        status: row.upload_status,
        state,
        sizeBytes: Number(row.size_bytes),
        pendingSizeBytes: row.pending_size_bytes === null ? null : Number(row.pending_size_bytes),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at?.toISOString() ?? null,
        attempts: row.recovery_attempts,
        maxAttempts: this.config.maxAttempts,
        nextRecoveryAt: row.next_recovery_at?.toISOString() ?? null,
        lastRecoveryAt: row.last_recovery_at?.toISOString() ?? null,
        lastOutcome: row.last_recovery_outcome,
        reviewReason: row.review_reason,
        lastErrorCode: row.last_error_code,
        explanation: explain(row, this.config.maxAttempts),
        inProgress: row.recovery_lease_until !== null && row.recovery_lease_until > now,
      };
    });
  }

  private async events(fileId: bigint): Promise<RecoveryEventView[]> {
    const type = await this.prisma.entity_types.findFirst({
      where: { code: ENTITY_CENTRAL_FILE, is_deleted: false },
      select: { id: true },
    });
    if (!type) return [];
    const rows = await this.prisma.events.findMany({
      where: { entity_type_id: type.id, entity_id: fileId, action: { contains: 'central_storage.recovery' } },
      orderBy: { occurred_at: 'desc' },
      take: MAX_EVENTS,
    });
    return rows.map((event) => ({
      action: event.action,
      actorType: event.actor_type,
      occurredAt: event.occurred_at.toISOString(),
      details: (event.new_values ?? {}) as Record<string, unknown>,
    }));
  }
}
