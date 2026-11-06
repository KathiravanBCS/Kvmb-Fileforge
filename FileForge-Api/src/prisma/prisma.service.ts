import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { PrismaClient } from '../../generated/prisma/client';
import databaseConfig from '../config/database.config';

/**
 * Query client for the existing fileforge_db schema (owned by fileforge_full_schema_v1_1.sql).
 *
 * - The connection is lazy: the API still boots if the database is down, and a query then fails
 *   (the login flow reports that as `service_unavailable`).
 * - TLS follows DATABASE_URL (`sslmode=require` on Azure). Certificate verification is not disabled.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(databaseConfig.KEY) config: ConfigType<typeof databaseConfig>) {
    const pool = new Pool({
      connectionString: config.url,
      // Sized by DATABASE_POOL_MAX; the whole server only has about 40 usable connections (see env.validation.ts).
      max: config.poolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    });
    super({ adapter: new PrismaPg(pool), log: ['error', 'warn'] });
    this.pool = pool;
    // An error on an idle pooled connection is emitted on the pool; unhandled, it would crash the process.
    pool.on('error', () => this.logger.warn({ event: 'db_pool_idle_client_error' }));
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}
