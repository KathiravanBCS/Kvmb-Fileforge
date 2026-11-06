import { TEST_ENV } from '../testing/test-env';
import centralStorageConfig from './central-storage.config';
import { decodeEncryptionKey, validateEnv } from './env.validation';

describe('CENTRAL_STORAGE_ENCRYPTION_KEY', () => {
  const valid: Record<string, unknown> = { ...TEST_ENV };
  const randomKey = (bytes = 32) => Buffer.from(Array.from({ length: bytes }, (_, i) => (i * 37 + 11) % 251));

  it('is required: the API must not start without it', () => {
    expect(() => validateEnv({ ...valid, CENTRAL_STORAGE_ENCRYPTION_KEY: undefined })).toThrow(
      /CENTRAL_STORAGE_ENCRYPTION_KEY/,
    );
    expect(() => validateEnv({ ...valid, CENTRAL_STORAGE_ENCRYPTION_KEY: '' })).toThrow(
      /CENTRAL_STORAGE_ENCRYPTION_KEY/,
    );
  });

  it.each([
    ['base64', randomKey().toString('base64')],
    ['base64url', randomKey().toString('base64url')],
  ])('accepts a 32-byte key as %s', (_label, value) => {
    expect(decodeEncryptionKey(value)?.length).toBe(32);
    expect(() => validateEnv({ ...valid, CENTRAL_STORAGE_ENCRYPTION_KEY: value })).not.toThrow();
  });

  it.each([
    ['too short (16 bytes)', randomKey(16).toString('base64')],
    ['too long (48 bytes)', randomKey(48).toString('base64')],
    ['not base64', 'this is definitely not a key!!!!!!!!!!!!!!!!!!!!!'],
    ['all identical bytes (a weak placeholder)', Buffer.alloc(32, 7).toString('base64')],
    ['an all-zero key', Buffer.alloc(32).toString('base64')],
  ])('rejects a key that is %s', (_label, value) => {
    expect(() => validateEnv({ ...valid, CENTRAL_STORAGE_ENCRYPTION_KEY: value })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('never echoes the key value in an error', () => {
    const secret = 'Zm9vYmFyLXRoaXMtaXMtYS1zZWNyZXQtYnV0LXRvby1zaG9ydA==';
    let message = '';
    try {
      validateEnv({ ...valid, CENTRAL_STORAGE_ENCRYPTION_KEY: secret });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('CENTRAL_STORAGE_ENCRYPTION_KEY');
    expect(message).not.toContain(secret);
  });

  it('validates the key version', () => {
    expect(() => validateEnv({ ...valid, CENTRAL_STORAGE_ENCRYPTION_KEY_VERSION: '0' })).toThrow(/KEY_VERSION/);
    expect(
      validateEnv({ ...valid, CENTRAL_STORAGE_ENCRYPTION_KEY_VERSION: undefined })
        .CENTRAL_STORAGE_ENCRYPTION_KEY_VERSION,
    ).toBe(1);
  });
});

describe('centralStorageConfig', () => {
  it('exposes the decoded 256-bit key and its version to the vault, and nothing else', () => {
    const config = centralStorageConfig();
    expect(Buffer.isBuffer(config.encryptionKey)).toBe(true);
    expect(config.encryptionKey.length).toBe(32);
    expect(config.keyVersion).toBe(1);
    expect(Object.keys(config).sort()).toEqual(['encryptionKey', 'keyVersion']);
  });
});
