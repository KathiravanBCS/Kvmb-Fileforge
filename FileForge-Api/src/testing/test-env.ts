/** Fake, non-secret values for automated tests. No real Microsoft or database credentials are ever used. */
export const TEST_ENV = {
  NODE_ENV: 'test',
  PORT: '4000',
  LOG_LEVEL: 'silent',
  FRONTEND_URL: 'http://localhost:3000',
  MICROSOFT_CLIENT_ID: '00000000-0000-0000-0000-000000000001',
  MICROSOFT_CLIENT_SECRET: 'test-client-secret-not-real',
  MICROSOFT_AUTHORITY: 'https://login.microsoftonline.com/common',
  MICROSOFT_REDIRECT_URI: 'http://localhost:4000/api/v1/auth/microsoft/callback',
  SESSION_SECRET: 'test-session-secret-0123456789-0123456789-0123456789',
  SESSION_TTL_MINUTES: '480',
  // Nothing listens here: PrismaService connects lazily, so no test ever reaches a database.
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
  // 32 bytes ("0123456789abcdef0123456789abcdef"): a fake key for tests only.
  CENTRAL_STORAGE_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  CENTRAL_STORAGE_ENCRYPTION_KEY_VERSION: '1',
  // 32 bytes ("fedcba9876543210fedcba9876543210"): a fake, DIFFERENT key for the session store (tests only).
  SESSION_ENCRYPTION_KEY: 'ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=',
} as const;

export function applyTestEnv(overrides: Record<string, string> = {}): void {
  Object.assign(process.env, TEST_ENV, overrides);
}
