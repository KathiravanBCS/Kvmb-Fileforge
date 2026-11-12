import type { Pool } from 'pg';

/** A stored session as it sits in public.sessions: ciphertext only. */
export interface StoredSession {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

export interface SessionWrite extends StoredSession {
  /** sha256 of the session id: the row key. */
  sidHash: Buffer;
  /** Plain id of the signed-in user (for revoking a user's sessions); null for visitors who are not signed in. */
  userId: bigint | null;
  expiresAt: Date;
}

/** Storage of encrypted sessions. The real one is PostgreSQL; tests use an in-memory one. */
export interface SessionRepository {
  /** The session if it exists and has not expired (by the database clock). */
  find(sidHash: Buffer): Promise<StoredSession | null>;
  /** Insert or replace. An existing row keeps the EARLIER expiry: a session never lives longer than it was created to. */
  upsert(write: SessionWrite): Promise<void>;
  remove(sidHash: Buffer): Promise<void>;
  removeExpired(): Promise<number>;
}

/** public.sessions over the pg driver. Plain statements with parameters only; nothing here ever sees plaintext session data. */
export class PgSessionRepository implements SessionRepository {
  constructor(private readonly pool: Pool) {}

  async find(sidHash: Buffer): Promise<StoredSession | null> {
    const { rows } = await this.pool.query<{
      payload_ciphertext: Buffer;
      payload_nonce: Buffer;
      payload_auth_tag: Buffer;
      encryption_key_version: number;
    }>(
      `SELECT payload_ciphertext, payload_nonce, payload_auth_tag, encryption_key_version
         FROM public.sessions
        WHERE sid_hash = $1 AND expires_at > clock_timestamp()`,
      [sidHash],
    );
    const row = rows[0];
    return row
      ? {
          ciphertext: row.payload_ciphertext,
          nonce: row.payload_nonce,
          authTag: row.payload_auth_tag,
          keyVersion: row.encryption_key_version,
        }
      : null;
  }

  async upsert(write: SessionWrite): Promise<void> {
    await this.pool.query(
      `INSERT INTO public.sessions
         (sid_hash, payload_ciphertext, payload_nonce, payload_auth_tag, encryption_key_version, user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (sid_hash) DO UPDATE SET
         payload_ciphertext = EXCLUDED.payload_ciphertext,
         payload_nonce = EXCLUDED.payload_nonce,
         payload_auth_tag = EXCLUDED.payload_auth_tag,
         encryption_key_version = EXCLUDED.encryption_key_version,
         user_id = EXCLUDED.user_id,
         updated_at = clock_timestamp(),
         expires_at = LEAST(public.sessions.expires_at, EXCLUDED.expires_at)`,
      [
        write.sidHash,
        write.ciphertext,
        write.nonce,
        write.authTag,
        write.keyVersion,
        write.userId === null ? null : write.userId.toString(),
        write.expiresAt,
      ],
    );
  }

  async remove(sidHash: Buffer): Promise<void> {
    await this.pool.query('DELETE FROM public.sessions WHERE sid_hash = $1', [sidHash]);
  }

  async removeExpired(): Promise<number> {
    const result = await this.pool.query('DELETE FROM public.sessions WHERE expires_at <= clock_timestamp()');
    return result.rowCount ?? 0;
  }
}
