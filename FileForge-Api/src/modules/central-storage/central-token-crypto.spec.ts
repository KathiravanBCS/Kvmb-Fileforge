import { randomBytes } from 'node:crypto';

import { cacheAad, CacheDecryptionError, decryptCache, encryptCache } from './central-token-crypto';

const KEY = randomBytes(32);
const PLAINTEXT = JSON.stringify({ RefreshToken: { secret: 'REFRESH-TOKEN-SECRET-VALUE' }, Account: { home: 'x' } });
const AAD = cacheAad(1, 5n, 'oid-admin');

describe('central token cache encryption (AES-256-GCM)', () => {
  it('round-trips, and the ciphertext does not contain the plaintext', () => {
    const sealed = encryptCache(KEY, PLAINTEXT, AAD);
    expect(sealed.nonce.length).toBe(12);
    expect(sealed.authTag.length).toBe(16);
    expect(sealed.ciphertext.toString('utf8')).not.toContain('REFRESH-TOKEN-SECRET-VALUE');
    expect(sealed.ciphertext.toString('base64')).not.toContain('REFRESH');
    expect(decryptCache(KEY, sealed, AAD)).toBe(PLAINTEXT);
  });

  it('uses a fresh random nonce for every encryption (never reused with the same key)', () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 2000; i++) nonces.add(encryptCache(KEY, 'x', AAD).nonce.toString('hex'));
    expect(nonces.size).toBe(2000);
  });

  it('fails closed when the ciphertext, nonce or tag was modified', () => {
    const sealed = encryptCache(KEY, PLAINTEXT, AAD);
    const flip = (buffer: Buffer) => {
      const copy = Buffer.from(buffer);
      copy[0] = copy[0] ^ 0x01;
      return copy;
    };
    expect(() => decryptCache(KEY, { ...sealed, ciphertext: flip(sealed.ciphertext) }, AAD)).toThrow(
      CacheDecryptionError,
    );
    expect(() => decryptCache(KEY, { ...sealed, nonce: flip(sealed.nonce) }, AAD)).toThrow(CacheDecryptionError);
    expect(() => decryptCache(KEY, { ...sealed, authTag: flip(sealed.authTag) }, AAD)).toThrow(CacheDecryptionError);
  });

  it('fails closed with a wrong key', () => {
    const sealed = encryptCache(KEY, PLAINTEXT, AAD);
    expect(() => decryptCache(randomBytes(32), sealed, AAD)).toThrow(CacheDecryptionError);
  });

  it('is bound to its context: another row, account or key version cannot decrypt it', () => {
    const sealed = encryptCache(KEY, PLAINTEXT, AAD);
    expect(() => decryptCache(KEY, sealed, cacheAad(1, 6n, 'oid-admin'))).toThrow(CacheDecryptionError);
    expect(() => decryptCache(KEY, sealed, cacheAad(1, 5n, 'oid-someone-else'))).toThrow(CacheDecryptionError);
    expect(() => decryptCache(KEY, sealed, cacheAad(2, 5n, 'oid-admin'))).toThrow(CacheDecryptionError);
  });

  it('rejects malformed stored values (wrong nonce / tag length) with the same opaque error', () => {
    const sealed = encryptCache(KEY, PLAINTEXT, AAD);
    expect(() => decryptCache(KEY, { ...sealed, nonce: Buffer.alloc(8) }, AAD)).toThrow(CacheDecryptionError);
    expect(() => decryptCache(KEY, { ...sealed, authTag: Buffer.alloc(4) }, AAD)).toThrow(CacheDecryptionError);
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => encryptCache(randomBytes(16), PLAINTEXT, AAD)).toThrow();
  });

  it('carries no detail in the error that could help an attacker or reach a log', () => {
    const sealed = encryptCache(KEY, PLAINTEXT, AAD);
    try {
      decryptCache(randomBytes(32), sealed, AAD);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CacheDecryptionError);
      expect((error as Error).message).not.toMatch(/key|tag|nonce|REFRESH/i);
    }
  });
});
