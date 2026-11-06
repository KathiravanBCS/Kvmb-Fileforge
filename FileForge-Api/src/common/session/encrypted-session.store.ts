import { createHash } from 'node:crypto';

import session, { type SessionData } from 'express-session';

import { Logger } from '@nestjs/common';

import { seal, SealedDataError, unseal } from '../utils/aes-gcm.util';
import type { SessionRepository } from './session.repository';

export interface EncryptedSessionStoreOptions {
  repository: SessionRepository;
  /** AES-256 key. NOT the central storage key: sessions and the central token cache rotate and leak independently. */
  key: Buffer;
  keyVersion: number;
  /** Lifetime for a session whose cookie says nothing about expiry. */
  defaultTtlMs: number;
}

/** The session id is a secret (with the cookie signature it is the credential): only its hash is ever stored or used as a key. */
export function hashSessionId(sid: string): Buffer {
  return createHash('sha256').update(sid, 'utf8').digest();
}

/** What the ciphertext is bound to: this exact session row and key version. A row copied elsewhere fails to decrypt. */
function aadFor(sidHash: Buffer, keyVersion: number): Buffer {
  return Buffer.concat([Buffer.from(`fileforge-session|v${keyVersion}|`, 'utf8'), sidHash]);
}

const USER_ID = /^\d{1,19}$/;

/**
 * express-session store that keeps sessions in PostgreSQL as AES-256-GCM ciphertext.
 *
 * A session holds the signed-in user, the CSRF token, pending OAuth state and the user's Microsoft token cache, so none of it is
 * ever written in plaintext: not to the table, not to a log. Failures are never logged with session content (only an event
 * name and error class). A row that cannot be decrypted or authenticated (wrong key, tampered, other key version) is treated
 * as "no session" and removed: the user simply signs in again, nothing is guessed or repaired.
 *
 * Lifetime is fixed when the session is created: updates never extend it (see SessionRepository.upsert).
 */
export class EncryptedPgSessionStore extends session.Store {
  private readonly logger = new Logger(EncryptedPgSessionStore.name);

  constructor(private readonly options: EncryptedSessionStoreOptions) {
    super();
  }

  get(sid: string, callback: (error: unknown, session?: SessionData | null) => void): void {
    void this.read(sid).then(
      (data) => callback(null, data),
      (error: unknown) => callback(error),
    );
  }

  set(sid: string, data: SessionData, callback?: (error?: unknown) => void): void {
    void this.save(sid, data).then(
      () => callback?.(),
      (error: unknown) => callback?.(error),
    );
  }

  destroy(sid: string, callback?: (error?: unknown) => void): void {
    void this.options.repository.remove(hashSessionId(sid)).then(
      () => callback?.(),
      (error: unknown) => callback?.(error),
    );
  }

  /** Unmodified sessions are not rewritten and the lifetime is fixed, so there is nothing to refresh. */
  touch(_sid: string, _data: SessionData, callback?: () => void): void {
    callback?.();
  }

  /** Cleanup of expired rows (called periodically under a singleton lock). */
  removeExpired(): Promise<number> {
    return this.options.repository.removeExpired();
  }

  private async read(sid: string): Promise<SessionData | null> {
    const sidHash = hashSessionId(sid);
    const stored = await this.options.repository.find(sidHash);
    if (!stored) return null;
    if (stored.keyVersion !== this.options.keyVersion) return this.discard(sidHash, 'session_key_version_unknown');
    try {
      const json = unseal(this.options.key, stored, aadFor(sidHash, stored.keyVersion));
      return JSON.parse(json) as SessionData;
    } catch (error) {
      return this.discard(
        sidHash,
        error instanceof SealedDataError ? 'session_decrypt_failed' : 'session_payload_invalid',
      );
    }
  }

  private async discard(sidHash: Buffer, event: string): Promise<null> {
    this.logger.warn({ event }); // never the session id, the payload or the key
    await this.options.repository.remove(sidHash).catch(() => undefined);
    return null;
  }

  private async save(sid: string, data: SessionData): Promise<void> {
    const sidHash = hashSessionId(sid);
    const { keyVersion, key } = this.options;
    const sealed = seal(key, JSON.stringify(data), aadFor(sidHash, keyVersion));
    const userId = data.user?.id;
    await this.options.repository.upsert({
      sidHash,
      ...sealed,
      keyVersion,
      userId: typeof userId === 'string' && USER_ID.test(userId) ? BigInt(userId) : null,
      expiresAt: this.expiryOf(data),
    });
  }

  private expiryOf(data: SessionData): Date {
    const cookie = data.cookie as { expires?: Date | string | null; originalMaxAge?: number | null } | undefined;
    if (cookie?.expires) return new Date(cookie.expires);
    return new Date(Date.now() + (cookie?.originalMaxAge ?? this.options.defaultTtlMs));
  }
}
