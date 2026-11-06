import { registerAs } from '@nestjs/config';

import { validateEnv } from './env.validation';

// Include `?sslmode=require` in DATABASE_URL for Azure Database for PostgreSQL. The URL is a secret: never log it.
export default registerAs('database', () => {
  const env = validateEnv(process.env);
  return {
    url: env.DATABASE_URL,
    /** Main (Prisma) pool size of THIS instance. Validated against the whole-server connection budget at startup. */
    poolMax: env.DATABASE_POOL_MAX,
  };
});
