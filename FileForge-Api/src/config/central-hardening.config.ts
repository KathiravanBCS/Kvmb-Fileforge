import { registerAs } from '@nestjs/config';

import { decodeEncryptionKey, validateEnv } from './env.validation';

const MINUTE_MS = 60_000;

/** Upload admission control: how many uploads a user may start, and how many may run at once. */
export const uploadLimitsConfig = registerAs('uploadLimits', () => {
  const env = validateEnv(process.env);
  return {
    windowMs: env.CENTRAL_UPLOAD_WINDOW_MINUTES * MINUTE_MS,
    userUploadLimit: env.CENTRAL_UPLOAD_USER_LIMIT,
    userReplaceLimit: env.CENTRAL_REPLACE_USER_LIMIT,
    adminUploadLimit: env.CENTRAL_ADMIN_UPLOAD_LIMIT,
    maxConcurrentPerUser: env.CENTRAL_UPLOAD_MAX_CONCURRENT_PER_USER,
    maxConcurrentGlobal: env.CENTRAL_UPLOAD_MAX_CONCURRENT_GLOBAL,
    slotLeaseMs: env.CENTRAL_UPLOAD_SLOT_LEASE_MINUTES * MINUTE_MS,
  };
});

/** The recovery (reconciliation) worker. */
export const recoveryConfig = registerAs('centralRecovery', () => {
  const env = validateEnv(process.env);
  return {
    enabled: env.CENTRAL_RECOVERY_ENABLED,
    intervalMs: env.CENTRAL_RECOVERY_INTERVAL_SECONDS * 1000,
    staleMs: env.CENTRAL_RECOVERY_STALE_MINUTES * MINUTE_MS,
    batchSize: env.CENTRAL_RECOVERY_BATCH_SIZE,
    maxAttempts: env.CENTRAL_RECOVERY_MAX_ATTEMPTS,
    leaseMs: env.CENTRAL_RECOVERY_LEASE_MINUTES * MINUTE_MS,
  };
});

/** Where sessions live. The key is only present (and only needed) for the PostgreSQL store. */
export const sessionStoreConfig = registerAs('sessionStore', () => {
  const env = validateEnv(process.env);
  return {
    kind: env.SESSION_STORE,
    poolMax: env.SESSION_STORE_POOL_MAX,
    encryptionKey: env.SESSION_ENCRYPTION_KEY ? decodeEncryptionKey(env.SESSION_ENCRYPTION_KEY) : null,
    keyVersion: env.SESSION_ENCRYPTION_KEY_VERSION,
  };
});
