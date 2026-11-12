import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { describeError } from '../../common/utils/logging.util';
import { uploadLimitsConfig } from '../../config/central-hardening.config';
import { PrismaService } from '../../prisma/prisma.service';
import { CENTRAL_ADMISSION_LOCK_KEY, CENTRAL_HOUSEKEEPING_LOCK_KEY } from './central-storage.constants';

export type UploadOperation = 'upload' | 'replace' | 'admin_upload';
export type SlotOutcome = 'completed' | 'failed' | 'cancelled';

/** What an admitted request holds. The token never leaves the server: only the holder can release the slot. */
export interface UploadSlot {
  id: bigint;
  token: string;
}

/** How long a caller should wait when the limit is about concurrency (no exact time is knowable). */
const CONCURRENCY_RETRY_SECONDS = 10;
/** Finished slots are kept this long for troubleshooting, then deleted. */
const SLOT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function limited(code: string, message: string, retryAfterSeconds: number): HttpException {
  return new HttpException({ code, message, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)) }, 429);
}

const wait = (seconds: number) =>
  seconds >= 120 ? `${Math.ceil(seconds / 60)} minutes` : `${Math.ceil(seconds)} seconds`;

/**
 * Upload admission control for central storage: how many uploads a user may START in a window, how many may RUN at once per
 * user, and how many may run at once overall (administrators included, so they cannot starve everyone else).
 *
 * The state lives in PostgreSQL (central_upload_slots), so every backend instance sees the same numbers. Admission is one
 * transaction under a single advisory lock: two parallel requests, on any instance, are decided one after the other and the
 * second one sees the first. Every comparison uses the DATABASE clock. A request that is refused records nothing, so it
 * consumes no capacity. A slot is freed when its request ends, only by presenting its own token; if an instance dies the slot's
 * lease expires and it is freed anyway.
 */
@Injectable()
export class CentralUploadAdmissionService {
  private readonly logger = new Logger(CentralUploadAdmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(uploadLimitsConfig.KEY) private readonly config: ConfigType<typeof uploadLimitsConfig>,
  ) {}

  async admit(userId: bigint, operation: UploadOperation, requestId?: string): Promise<UploadSlot> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CENTRAL_ADMISSION_LOCK_KEY})`;
        const now = await this.databaseNow(tx);

        // Slots whose instance died are freed first, so they never block anybody.
        await tx.central_upload_slots.updateMany({
          where: { released_at: null, lease_expires_at: { lte: now } },
          data: { released_at: now, outcome: 'expired' },
        });

        const openOverall = await tx.central_upload_slots.count({ where: { released_at: null } });
        if (openOverall >= this.config.maxConcurrentGlobal) {
          throw limited(
            'UPLOAD_CAPACITY_BUSY',
            'The storage is handling as many uploads as it can right now. Please try again shortly.',
            CONCURRENCY_RETRY_SECONDS,
          );
        }

        const openForUser = await tx.central_upload_slots.count({ where: { user_id: userId, released_at: null } });
        if (openForUser >= this.config.maxConcurrentPerUser) {
          throw limited(
            'UPLOAD_TOO_MANY_ACTIVE',
            `You already have ${openForUser} uploads running. Wait for one to finish, then try again.`,
            CONCURRENCY_RETRY_SECONDS,
          );
        }

        const limit = this.limitFor(operation);
        const windowStart = new Date(now.getTime() - this.config.windowMs);
        const recent = await tx.central_upload_slots.findMany({
          where: { user_id: userId, operation, created_at: { gt: windowStart } },
          orderBy: { created_at: 'asc' },
          take: limit,
          select: { created_at: true },
        });
        if (recent.length >= limit) {
          // The oldest admission leaves the window first; that is when one more is allowed.
          const oldest = recent[0]?.created_at ?? now;
          const retryAfter = (oldest.getTime() + this.config.windowMs - now.getTime()) / 1000;
          throw limited(
            'UPLOAD_RATE_LIMITED',
            `You have reached the limit of ${limit} ${operation === 'replace' ? 'replacements' : 'uploads'} per ${wait(this.config.windowMs / 1000)}. Try again in ${wait(retryAfter)}.`,
            retryAfter,
          );
        }

        const slot = await tx.central_upload_slots.create({
          data: {
            user_id: userId,
            operation,
            request_id: requestId ?? null,
            created_at: now,
            lease_expires_at: new Date(now.getTime() + this.config.slotLeaseMs),
          },
        });
        return { id: slot.id, token: slot.lease_token };
      },
      { timeout: 10_000, maxWait: 10_000 },
    );
  }

  /** Frees a slot. Only the holder's own token works; anything else (another request, a guess) changes nothing. */
  async release(slot: UploadSlot, outcome: SlotOutcome): Promise<boolean> {
    const now = await this.databaseNow(this.prisma);
    const released = await this.prisma.central_upload_slots.updateMany({
      where: { id: slot.id, lease_token: slot.token, released_at: null },
      data: { released_at: now, outcome },
    });
    return released.count === 1;
  }

  /** Periodic cleanup (called by the worker under a singleton lock): free dead leases, drop old finished rows. */
  async housekeeping(): Promise<{ expired: number; deleted: number }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const [lock] = await tx.$queryRaw<
          { locked: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(${CENTRAL_HOUSEKEEPING_LOCK_KEY}) AS locked`;
        if (!lock?.locked) return { expired: 0, deleted: 0 }; // another instance is doing it right now
        const now = await this.databaseNow(tx);
        const expired = await tx.central_upload_slots.updateMany({
          where: { released_at: null, lease_expires_at: { lte: now } },
          data: { released_at: now, outcome: 'expired' },
        });
        const deleted = await tx.central_upload_slots.deleteMany({
          where: { released_at: { not: null, lt: new Date(now.getTime() - SLOT_RETENTION_MS) } },
        });
        return { expired: expired.count, deleted: deleted.count };
      });
    } catch (error) {
      this.logger.warn({ event: 'central_upload_slots_housekeeping_failed', error: describeError(error) });
      return { expired: 0, deleted: 0 };
    }
  }

  private limitFor(operation: UploadOperation): number {
    switch (operation) {
      case 'upload':
        return this.config.userUploadLimit;
      case 'replace':
        return this.config.userReplaceLimit;
      case 'admin_upload':
        return this.config.adminUploadLimit;
    }
  }

  /** The database's clock, not this server's: instances with skewed clocks must all agree. */
  private async databaseNow(client: Pick<PrismaService, '$queryRaw'>): Promise<Date> {
    const [row] = await client.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    if (!row) throw new Error('database clock unavailable');
    return row.now;
  }
}
