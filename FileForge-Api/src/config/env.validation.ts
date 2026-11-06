import { z } from 'zod';

import { MICROSOFT_CALLBACK_PATH } from '../common/constants/api.constants';

// z.url() alone accepts "localhost:3000" (scheme "localhost:"), which breaks CORS and redirects.
const httpUrl = z.url({ protocol: /^https?$/ });

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

/**
 * Decodes a base64 / base64url AES-256 key. Returns null unless it is exactly 32 bytes and not a trivial pattern
 * (all-identical bytes, e.g. a zero key). The value itself is never echoed in an error.
 */
export function decodeEncryptionKey(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/_-]{43,44}={0,2}$/.test(value)) return null;
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.every((byte) => byte === key[0])) return null;
  return key;
}

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
    FRONTEND_URL: httpUrl,
    // Set to true only when running behind a TLS-terminating reverse proxy (e.g. Azure App Service).
    TRUST_PROXY: booleanString,

    MICROSOFT_CLIENT_ID: z.string().trim().min(1, 'is required'),
    MICROSOFT_CLIENT_SECRET: z.string().min(1, 'is required'),
    MICROSOFT_AUTHORITY: httpUrl.default('https://login.microsoftonline.com/common'),
    // Microsoft sends the browser here after sign-in, so the path must be the real route, or the callback 404s.
    MICROSOFT_REDIRECT_URI: httpUrl.refine(
      (value) => new URL(value).pathname === MICROSOFT_CALLBACK_PATH,
      `must end with ${MICROSOFT_CALLBACK_PATH}`,
    ),

    SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
    SESSION_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(480),

    DATABASE_URL: z
      .string()
      .min(1, 'is required')
      .refine((value) => /^postgres(ql)?:\/\//.test(value), 'must be a postgresql:// connection string'),

    // AES-256-GCM key that protects the central OneDrive token cache stored in PostgreSQL. Generate with:
    //   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
    CENTRAL_STORAGE_ENCRYPTION_KEY: z
      .string()
      .min(1, 'is required')
      .refine(
        (value) => decodeEncryptionKey(value) !== null,
        'must be a base64-encoded random 256-bit (32-byte) key (see .env.example)',
      ),
    // Which key is current. Stored with every encrypted cache so a future key rotation can tell old from new.
    CENTRAL_STORAGE_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).max(32767).default(1),

    // ---- PostgreSQL connection budget -------------------------------------------------------------------------------
    // Azure PostgreSQL allows 50 connections in total and reserves 10, so about 40 are usable by ALL backend instances and tools together.
    // Every instance opens DATABASE_POOL_MAX (main pool) + SESSION_STORE_POOL_MAX (only with SESSION_STORE=postgres). The product of that and
    // the number of instances must fit DATABASE_CONNECTION_LIMIT, or the API refuses to start instead of exhausting the server.
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(10),
    DATABASE_INSTANCE_COUNT: z.coerce.number().int().min(1).max(50).default(1),
    DATABASE_CONNECTION_LIMIT: z.coerce.number().int().min(2).max(500).default(40),

    // ---- Sessions -----------------------------------------------------------------------------------------------------
    // `memory` is for local development only. `postgres` keeps sessions in core.sessions as AES-256-GCM ciphertext (they hold users'
    // Microsoft token caches). Production refuses to start with `memory`.
    SESSION_STORE: z.enum(['memory', 'postgres']).default('memory'),
    // MUST be a different key from CENTRAL_STORAGE_ENCRYPTION_KEY: independent rotation, and one leaked key never opens both.
    SESSION_ENCRYPTION_KEY: z
      .string()
      .optional()
      .refine(
        (value) => value === undefined || value === '' || decodeEncryptionKey(value) !== null,
        'must be a base64-encoded random 256-bit (32-byte) key (see .env.example)',
      ),
    SESSION_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).max(32767).default(1),
    SESSION_STORE_POOL_MAX: z.coerce.number().int().min(1).max(10).default(3),

    // ---- Central storage: upload admission control (shared by every instance, kept in PostgreSQL) ---------------------
    CENTRAL_UPLOAD_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(10),
    CENTRAL_UPLOAD_USER_LIMIT: z.coerce.number().int().min(1).max(10_000).default(10),
    CENTRAL_REPLACE_USER_LIMIT: z.coerce.number().int().min(1).max(10_000).default(10),
    CENTRAL_ADMIN_UPLOAD_LIMIT: z.coerce.number().int().min(1).max(10_000).default(60),
    CENTRAL_UPLOAD_MAX_CONCURRENT_PER_USER: z.coerce.number().int().min(1).max(50).default(3),
    CENTRAL_UPLOAD_MAX_CONCURRENT_GLOBAL: z.coerce.number().int().min(1).max(500).default(8),
    // A slot is freed when its request ends; the lease only frees it if the instance died. Must outlast the slowest legitimate upload.
    CENTRAL_UPLOAD_SLOT_LEASE_MINUTES: z.coerce.number().int().min(2).max(120).default(15),

    // ---- Central storage: recovery worker ---------------------------------------------------------------------------
    // Off by default: switch it on deliberately (it repairs files in your OneDrive).
    CENTRAL_RECOVERY_ENABLED: booleanString,
    CENTRAL_RECOVERY_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
    // Only rows untouched for this long are looked at. Must be longer than an upload can legitimately run (the slot lease), so the
    // worker never repairs something a live request is still working on.
    CENTRAL_RECOVERY_STALE_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
    CENTRAL_RECOVERY_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    CENTRAL_RECOVERY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(6),
    // How long one worker owns one file while repairing it (renewed during the work; expires if the worker dies).
    CENTRAL_RECOVERY_LEASE_MINUTES: z.coerce.number().int().min(1).max(60).default(5),
  })
  .superRefine((env, ctx) => {
    const problem = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });

    const sessionKey = env.SESSION_ENCRYPTION_KEY ? decodeEncryptionKey(env.SESSION_ENCRYPTION_KEY) : null;
    const centralKey = decodeEncryptionKey(env.CENTRAL_STORAGE_ENCRYPTION_KEY);
    if (env.SESSION_STORE === 'postgres' && !sessionKey)
      problem('SESSION_ENCRYPTION_KEY', 'is required when SESSION_STORE=postgres');
    if (sessionKey && centralKey && sessionKey.equals(centralKey)) {
      problem('SESSION_ENCRYPTION_KEY', 'must be different from CENTRAL_STORAGE_ENCRYPTION_KEY');
    }
    if (env.NODE_ENV === 'production' && env.SESSION_STORE !== 'postgres') {
      problem(
        'SESSION_STORE',
        'must be "postgres" in production (the in-memory store loses sessions and cannot be shared)',
      );
    }

    const perInstance = env.DATABASE_POOL_MAX + (env.SESSION_STORE === 'postgres' ? env.SESSION_STORE_POOL_MAX : 0);
    if (env.DATABASE_INSTANCE_COUNT * perInstance > env.DATABASE_CONNECTION_LIMIT) {
      problem(
        'DATABASE_POOL_MAX',
        `${env.DATABASE_INSTANCE_COUNT} instance(s) x ${perInstance} connections exceeds DATABASE_CONNECTION_LIMIT (${env.DATABASE_CONNECTION_LIMIT}); lower the pool sizes or raise the limit`,
      );
    }
    if (env.CENTRAL_RECOVERY_STALE_MINUTES <= env.CENTRAL_UPLOAD_SLOT_LEASE_MINUTES) {
      problem('CENTRAL_RECOVERY_STALE_MINUTES', 'must be longer than CENTRAL_UPLOAD_SLOT_LEASE_MINUTES');
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Throws with variable names and reasons only. Values (which may be secrets) are never echoed. */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment configuration. Fix the following (see .env.example):\n${details}`);
  }
  return result.data;
}
