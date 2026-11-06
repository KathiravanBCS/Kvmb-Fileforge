import { Pool } from 'pg';

import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import authConfig from '../../config/auth.config';
import { sessionStoreConfig } from '../../config/central-hardening.config';
import databaseConfig from '../../config/database.config';
import { EncryptedPgSessionStore } from './encrypted-session.store';
import { PgSessionRepository } from './session.repository';

const CLEANUP_INTERVAL_MS = 10 * 60_000;

/**
 * Owns the session store for the process. With SESSION_STORE=postgres it holds its OWN small pool (SESSION_STORE_POOL_MAX), so a
 * burst of API queries cannot starve logins and the connection budget stays explicit (see env.validation.ts). Both the pool and
 * the cleanup timer are lazy/background: the API still boots with the database down, and the first session read then fails.
 * With SESSION_STORE=memory (development only, rejected in production) `store` is undefined and express-session's default is used.
 */
@Injectable()
export class SessionStoreService implements OnModuleDestroy {
  readonly store: EncryptedPgSessionStore | undefined;
  private readonly logger = new Logger(SessionStoreService.name);
  private readonly pool: Pool | undefined;
  private readonly timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(sessionStoreConfig.KEY) config: ConfigType<typeof sessionStoreConfig>,
    @Inject(databaseConfig.KEY) database: ConfigType<typeof databaseConfig>,
    @Inject(authConfig.KEY) auth: ConfigType<typeof authConfig>,
  ) {
    if (config.kind !== 'postgres' || !config.encryptionKey) return;
    this.pool = new Pool({
      connectionString: database.url,
      max: config.poolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    });
    this.pool.on('error', () => this.logger.warn({ event: 'session_pool_idle_client_error' }));
    this.store = new EncryptedPgSessionStore({
      repository: new PgSessionRepository(this.pool),
      key: config.encryptionKey,
      keyVersion: config.keyVersion,
      defaultTtlMs: auth.session.ttlMs,
    });
    // Deleting expired rows is idempotent, so every instance may run it: no coordination needed.
    this.timer = setInterval(() => void this.cleanup(), CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.pool?.end();
  }

  private async cleanup(): Promise<void> {
    try {
      const removed = await this.store?.removeExpired();
      if (removed) this.logger.log({ event: 'sessions_expired_removed', removed });
    } catch {
      this.logger.warn({ event: 'sessions_cleanup_failed' });
    }
  }
}
