import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** What is stored for one encrypted value: ciphertext, a fresh random nonce, and the GCM authentication tag. */
export interface Sealed {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
}

/** Wrong key, tampered data or wrong context. Carries no detail: the cause must not help an attacker or reach a log. */
export class SealedDataError extends Error {
  constructor() {
    super('The stored data could not be decrypted.');
    this.name = 'SealedDataError';
  }
}

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM with a fresh cryptographically random 96-bit nonce for EVERY call. `aad` binds the value to its context. */
export function seal(key: Buffer, plaintext: string, aad: Buffer): Sealed {
  if (key.length !== 32) throw new Error('The encryption key must be 32 bytes.');
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext, nonce, authTag: cipher.getAuthTag() };
}

/** Throws SealedDataError for any failure (wrong key, modified ciphertext/nonce/tag, wrong AAD, bad lengths). */
export function unseal(key: Buffer, sealed: Sealed, aad: Buffer): string {
  try {
    if (key.length !== 32 || sealed.nonce.length !== NONCE_BYTES || sealed.authTag.length !== TAG_BYTES) {
      throw new SealedDataError();
    }
    const decipher = createDecipheriv(ALGORITHM, key, sealed.nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(sealed.authTag);
    return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new SealedDataError();
  }
}
