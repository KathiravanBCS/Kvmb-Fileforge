import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { describeError } from '../../common/utils/logging.util';
import { recoveryConfig } from '../../config/central-hardening.config';
import { CentralRecoveryService } from './central-recovery.service';
import { CentralUploadAdmissionService } from './central-upload-admission.service';

const HOUSEKEEPING_INTERVAL_MS = 10 * 60_000;

/**
 * Background timers of one backend instance (in-process; no queue, no extra infrastructure):
 *  - housekeeping of upload slots, ALWAYS on (cheap; coordinated across instances by a PostgreSQL advisory lock);
 *  - the recovery pass, only when CENTRAL_RECOVERY_ENABLED=true. Several instances may all run it: each file is owned through
 *    a row lease (see CentralRecoveryService), so they never work on the same file at the same time.
 * Nothing runs at startup itself: the first pass happens one interval later. A pass never overlaps the previous one, and
 * shutdown waits for the pass in progress (bounded by the lease, which then expires on its own).
 */
@Injectable()
export class CentralRecoveryWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CentralRecoveryWorker.name);
  private timers: NodeJS.Timeout[] = [];
  private current: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly recovery: CentralRecoveryService,
    private readonly admission: CentralUploadAdmissionService,
    @Inject(recoveryConfig.KEY) private readonly config: ConfigType<typeof recoveryConfig>,
  ) {}

  onApplicationBootstrap(): void {
    this.every(HOUSEKEEPING_INTERVAL_MS, () => this.admission.housekeeping().then(() => undefined));
    if (this.config.enabled) {
      this.every(this.config.intervalMs, () => this.recoverPass());
      this.logger.log({ event: 'central_recovery_enabled', intervalMs: this.config.intervalMs });
    } else {
      this.logger.log({ event: 'central_recovery_disabled' });
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.timers.forEach((timer) => clearInterval(timer));
    this.timers = [];
    await this.current;
  }

  private every(ms: number, job: () => Promise<void>): void {
    const timer = setInterval(() => {
      if (this.current || this.stopping) return; // one pass at a time
      this.current = job()
        .catch((error: unknown) =>
          this.logger.error({ event: 'central_background_job_failed', error: describeError(error) }),
        )
        .finally(() => {
          this.current = null;
        });
    }, ms);
    timer.unref();
    this.timers.push(timer);
  }

  private async recoverPass(): Promise<void> {
    const summary = await this.recovery.runOnce(() => this.stopping);
    if (summary.examined > 0) this.logger.log({ event: 'central_recovery_pass', ...summary });
  }
}
