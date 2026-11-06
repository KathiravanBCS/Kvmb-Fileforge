import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** What is stored in storage.central_connection: ciphertext, a fresh random nonce, and the GCM authentication tag. */
export interface EncryptedCache {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
}

/** Wrong key, tampered data or wrong context. Carries no detail: the cause must not help an attacker or reach a log. */
export class CacheDecryptionError extends Error {
  constructor() {
    super('The stored token cache could not be decrypted.');
    this.name = 'CacheDecryptionError';
  }
}

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/**
 * The GCM additional authenticated data. It is not secret and not stored: it is rebuilt on every read, so a
 * ciphertext copied to another row, another Microsoft account or another key version fails authentication.
 */
export function cacheAad(keyVersion: number, connectionId: bigint, accountSubject: string): Buffer {
  return Buffer.from(`fileforge-central-cache|v${keyVersion}|${connectionId}|${accountSubject}`, 'utf8');
}

/** AES-256-GCM with a fresh cryptographically random 96-bit nonce for EVERY call. Never reuse a nonce with a key. */
export function encryptCache(key: Buffer, plaintext: string, aad: Buffer): EncryptedCache {
  if (key.length !== 32) throw new Error('The encryption key must be 32 bytes.');
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext, nonce, authTag: cipher.getAuthTag() };
}

/** Throws CacheDecryptionError for any failure (wrong key, modified ciphertext/nonce/tag, wrong AAD, bad lengths). */
export function decryptCache(key: Buffer, encrypted: EncryptedCache, aad: Buffer): string {
  try {
    if (key.length !== 32 || encrypted.nonce.length !== NONCE_BYTES || encrypted.authTag.length !== TAG_BYTES) {
      throw new CacheDecryptionError();
    }
    const decipher = createDecipheriv(ALGORITHM, key, encrypted.nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(encrypted.authTag);
    return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new CacheDecryptionError();
  }
}
