import { TEST_ENV } from '../testing/test-env';
import authConfig from './auth.config';
import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const valid: Record<string, unknown> = { ...TEST_ENV };

  it('accepts a complete configuration and applies defaults', () => {
    const env = validateEnv({ ...valid, SESSION_TTL_MINUTES: undefined, TRUST_PROXY: undefined });
    expect(env.PORT).toBe(4000);
    expect(env.SESSION_TTL_MINUTES).toBe(480);
    expect(env.TRUST_PROXY).toBe(false);
  });

  it('reports missing settings by name and never echoes values', () => {
    const leaked = 'tooshort-secret-value';
    let message = '';
    try {
      validateEnv({ ...valid, MICROSOFT_CLIENT_ID: '', MICROSOFT_CLIENT_SECRET: '', SESSION_SECRET: leaked });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('MICROSOFT_CLIENT_ID');
    expect(message).toContain('MICROSOFT_CLIENT_SECRET');
    expect(message).toContain('SESSION_SECRET');
    expect(message).not.toContain(leaked);
  });

  it('rejects an empty Microsoft configuration, as in an untouched .env.example', () => {
    expect(() =>
      validateEnv({
        ...valid,
        MICROSOFT_CLIENT_ID: '',
        MICROSOFT_CLIENT_SECRET: '',
        SESSION_SECRET: '',
        DATABASE_URL: '',
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it.each([
    ['a session secret shorter than 32 characters', { SESSION_SECRET: 'x'.repeat(31) }],
    ['a non-URL frontend', { FRONTEND_URL: 'localhost:3000' }],
    ['a non-PostgreSQL database URL', { DATABASE_URL: 'mysql://u:p@host/db' }],
    ['an out-of-range port', { PORT: '70000' }],
  ])('rejects %s', (_label, override) => {
    expect(() => validateEnv({ ...valid, ...override })).toThrow(/Invalid environment configuration/);
  });

  describe('MICROSOFT_REDIRECT_URI', () => {
    it('must point at the real, prefixed callback route, or Microsoft would send users to a 404', () => {
      // The pre-/api/v1 path that an older .env may still contain.
      expect(() =>
        validateEnv({ ...valid, MICROSOFT_REDIRECT_URI: 'http://localhost:4000/auth/microsoft/callback' }),
      ).toThrow(/MICROSOFT_REDIRECT_URI: must end with \/api\/v1\/auth\/microsoft\/callback/);
      expect(() => validateEnv({ ...valid, MICROSOFT_REDIRECT_URI: 'http://localhost:4000/' })).toThrow(
        /MICROSOFT_REDIRECT_URI/,
      );
    });

    it('accepts any host with the right path (deployed environments)', () => {
      expect(
        validateEnv({ ...valid, MICROSOFT_REDIRECT_URI: 'https://api.example.com/api/v1/auth/microsoft/callback' })
          .MICROSOFT_REDIRECT_URI,
      ).toBe('https://api.example.com/api/v1/auth/microsoft/callback');
    });
  });
});

describe('authConfig', () => {
  const original = process.env['FRONTEND_URL'];
  afterEach(() => {
    process.env['FRONTEND_URL'] = original;
  });

  it('uses plain cookies over http (local development)', () => {
    const { session } = authConfig();
    expect(session.secureCookies).toBe(false);
    expect(session.cookieName).toBe('fileforge.sid');
  });

  it('switches to Secure, __Host- prefixed cookies when the frontend is https', () => {
    process.env['FRONTEND_URL'] = 'https://app.example.com';
    const { session } = authConfig();
    expect(session.secureCookies).toBe(true);
    expect(session.cookieName).toBe('__Host-fileforge.sid');
  });

  it('only requests sign-in scopes, not file or mail permissions', () => {
    const { microsoft } = authConfig();
    expect(microsoft.loginScopes).toEqual(expect.arrayContaining(['openid', 'offline_access', 'User.Read']));
    expect(microsoft.loginScopes.join(' ')).not.toMatch(/Files|Mail/);
  });
});

describe('validateEnv: production readiness settings', () => {
  const valid: Record<string, unknown> = { ...TEST_ENV };
  const CENTRAL_KEY = TEST_ENV.CENTRAL_STORAGE_ENCRYPTION_KEY;
  const OTHER_KEY = TEST_ENV.SESSION_ENCRYPTION_KEY;
  const production = { ...valid, NODE_ENV: 'production', SESSION_STORE: 'postgres' };

  it('defaults to the approved limits and keeps recovery OFF', () => {
    const env = validateEnv(valid);
    expect(env).toMatchObject({
      CENTRAL_UPLOAD_WINDOW_MINUTES: 10,
      CENTRAL_UPLOAD_USER_LIMIT: 10,
      CENTRAL_REPLACE_USER_LIMIT: 10,
      CENTRAL_ADMIN_UPLOAD_LIMIT: 60,
      CENTRAL_UPLOAD_MAX_CONCURRENT_PER_USER: 3,
      CENTRAL_UPLOAD_MAX_CONCURRENT_GLOBAL: 8,
      CENTRAL_RECOVERY_ENABLED: false,
      SESSION_STORE: 'memory',
    });
  });

  it('accepts a complete production configuration', () => {
    expect(() => validateEnv(production)).not.toThrow();
  });

  describe('session store', () => {
    it('production refuses the in-memory store', () => {
      expect(() => validateEnv({ ...production, SESSION_STORE: 'memory' })).toThrow(
        /SESSION_STORE: must be "postgres"/,
      );
      expect(() => validateEnv({ ...production, SESSION_STORE: undefined })).toThrow(/SESSION_STORE/);
    });

    it('the PostgreSQL store needs its own encryption key', () => {
      expect(() => validateEnv({ ...production, SESSION_ENCRYPTION_KEY: undefined })).toThrow(
        /SESSION_ENCRYPTION_KEY: is required/,
      );
      expect(() => validateEnv({ ...production, SESSION_ENCRYPTION_KEY: '' })).toThrow(
        /SESSION_ENCRYPTION_KEY: is required/,
      );
    });

    it('the session key must NOT be the central storage key', () => {
      expect(() => validateEnv({ ...production, SESSION_ENCRYPTION_KEY: CENTRAL_KEY })).toThrow(
        /SESSION_ENCRYPTION_KEY: must be different from CENTRAL_STORAGE_ENCRYPTION_KEY/,
      );
      expect(() => validateEnv({ ...production, SESSION_ENCRYPTION_KEY: OTHER_KEY })).not.toThrow();
    });

    it.each([
      ['not base64', 'not-a-key!!'],
      ['16 bytes', Buffer.alloc(16, 1).toString('base64')],
      ['64 bytes', Buffer.alloc(64, 1).toString('base64')],
    ])('rejects a session key that is %s, without echoing it', (_label, key) => {
      let message = '';
      try {
        validateEnv({ ...production, SESSION_ENCRYPTION_KEY: key });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/SESSION_ENCRYPTION_KEY/);
      expect(message).not.toContain(key);
    });

    it('development may use the in-memory store without any session key', () => {
      expect(() => validateEnv({ ...valid, SESSION_ENCRYPTION_KEY: undefined })).not.toThrow();
    });
  });

  describe('PostgreSQL connection budget (Azure: 50 connections, 10 reserved)', () => {
    it('accepts instances x (main pool + session pool) within the limit', () => {
      // 3 x (10 + 3) = 39 <= 40
      expect(() => validateEnv({ ...production, DATABASE_INSTANCE_COUNT: '3' })).not.toThrow();
    });

    it('refuses to start when the instances would exhaust the server', () => {
      // 4 x (10 + 3) = 52 > 40
      expect(() => validateEnv({ ...production, DATABASE_INSTANCE_COUNT: '4' })).toThrow(
        /exceeds DATABASE_CONNECTION_LIMIT \(40\)/,
      );
    });

    it('counts the session pool only when the PostgreSQL session store is used', () => {
      // 4 x 10 = 40 fits with the memory store, 4 x 13 = 52 does not with postgres.
      expect(() => validateEnv({ ...valid, DATABASE_INSTANCE_COUNT: '4' })).not.toThrow();
      expect(() => validateEnv({ ...valid, DATABASE_INSTANCE_COUNT: '4', SESSION_STORE: 'postgres' })).toThrow(
        /DATABASE_CONNECTION_LIMIT/,
      );
    });

    it('can be satisfied by smaller pools', () => {
      expect(() =>
        validateEnv({
          ...production,
          DATABASE_INSTANCE_COUNT: '4',
          DATABASE_POOL_MAX: '6',
          SESSION_STORE_POOL_MAX: '2',
        }),
      ).not.toThrow(); // 4 x 8 = 32
    });
  });

  describe('recovery timing', () => {
    it('a file must be untouched for longer than an upload may legitimately run', () => {
      expect(() =>
        validateEnv({ ...valid, CENTRAL_UPLOAD_SLOT_LEASE_MINUTES: '30', CENTRAL_RECOVERY_STALE_MINUTES: '30' }),
      ).toThrow(/CENTRAL_RECOVERY_STALE_MINUTES: must be longer than CENTRAL_UPLOAD_SLOT_LEASE_MINUTES/);
      expect(() =>
        validateEnv({ ...valid, CENTRAL_UPLOAD_SLOT_LEASE_MINUTES: '30', CENTRAL_RECOVERY_STALE_MINUTES: '31' }),
      ).not.toThrow();
    });

    it.each([
      ['a zero upload limit', { CENTRAL_UPLOAD_USER_LIMIT: '0' }],
      ['a non-numeric limit', { CENTRAL_UPLOAD_MAX_CONCURRENT_GLOBAL: 'many' }],
      ['an absurd batch size', { CENTRAL_RECOVERY_BATCH_SIZE: '100000' }],
      ['a too-frequent worker', { CENTRAL_RECOVERY_INTERVAL_SECONDS: '1' }],
    ])('rejects %s', (_label, override) => {
      expect(() => validateEnv({ ...valid, ...override })).toThrow(/Invalid environment configuration/);
    });
  });
});
