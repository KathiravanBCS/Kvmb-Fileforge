import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { AuthFlowError } from '../../common/exceptions/auth-flow.error';
import { describeError } from '../../common/utils/logging.util';
import centralStorageConfig from '../../config/central-storage.config';
import { PrismaService } from '../../prisma/prisma.service';
import type { GraphRequestContext } from '../microsoft/graph/graph.client';
import { MicrosoftIdentityService } from '../microsoft/identity/microsoft-identity.service';
import type { TokenCacheStore } from '../microsoft/identity/microsoft-identity.types';
import { MicrosoftApiError } from '../microsoft/microsoft.errors';
import { FILES_SCOPE, ONEDRIVE_PROVIDER_CODE } from '../storage/onedrive/onedrive.constants';
import { notConnected, reconnectRequired } from './central-storage-errors';
import { CENTRAL_REFRESH_LOCK_KEY } from './central-storage.constants';
import { cacheAad, CacheDecryptionError, decryptCache, encryptCache } from './central-token-crypto';
import type {
  CentralGraphContext,
  CentralLayout,
  ConnectedAccount,
  UsableCentralConnection,
} from './types/central-storage.types';

type ConnectionRow = NonNullable<Awaited<ReturnType<CentralTokenVault['findLive']>>>;

/** Refresh the access token this long before it expires. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** Used when Microsoft does not say when the access token expires. */
const FALLBACK_ACCESS_LIFETIME_MS = 30 * 60 * 1000;

const bytes = (buffer: Buffer): Uint8Array<ArrayBuffer> => new Uint8Array(buffer);

/**
 * The only place that touches the central OneDrive's Microsoft tokens.
 *
 * The MSAL token cache (it holds the refresh token) lives in PostgreSQL ONLY as AES-256-GCM ciphertext. It is decrypted
 * in memory for one operation at a time and never logged, returned by an API, or written anywhere in plaintext.
 *
 * - Fails closed: a cache that cannot be decrypted or authenticated marks the connection `error` and refuses all use.
 *   It never creates, replaces or "repairs" a connection by itself; only an explicit administrator reconnect does.
 * - Refreshing the access token is serialized with a Postgres advisory lock, so several requests or several backend
 *   instances never refresh at once, and every cache write is compare-and-swap on `cache_revision`.
 * - It keeps working while nobody is signed in: it depends on the stored refresh token, not on any user session.
 */
@Injectable()
export class CentralTokenVault {
  private readonly logger = new Logger(CentralTokenVault.name);
  /** When the access token last obtained by THIS process stops being usable. 0 = unknown, refresh on first use. */
  private accessValidUntil = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: MicrosoftIdentityService,
    @Inject(centralStorageConfig.KEY) private readonly config: ConfigType<typeof centralStorageConfig>,
  ) {}

  /** The one live (not soft-deleted) central connection row, or null. Contains ciphertext: never return it to a client. */
  findLive() {
    return this.prisma.central_connection.findFirst({ where: { is_deleted: false }, orderBy: { id: 'asc' } });
  }

  /** The ids a Graph call is built from, or a 503 (not connected / reconnect required). Never exposes tokens. */
  async usableConnection(): Promise<UsableCentralConnection> {
    return this.toUsable(await this.requireUsableRow());
  }

  /**
   * Runs a Graph operation as the central OneDrive account. `fn` receives a Graph context whose token cache is the
   * decrypted snapshot; anything MSAL changes during `fn` is written back (if nobody wrote a newer cache meanwhile).
   */
  async withGraph<T>(fn: (context: CentralGraphContext) => Promise<T>): Promise<T> {
    const first = await this.requireUsableRow();
    try {
      let row = first;
      if (Date.now() > this.accessValidUntil - REFRESH_MARGIN_MS) row = await this.refresh();

      let current = this.decrypt(row);
      let dirty = false;
      const cache: TokenCacheStore = {
        load: () => current,
        save: (serialized) => {
          current = serialized;
          dirty = true;
        },
      };
      const graph: GraphRequestContext = { cache, homeAccountId: row.home_account_id };
      try {
        return await fn({ graph, connection: this.toUsable(row) });
      } finally {
        // E.g. Graph answered 401 and the client renewed the token itself: keep that newer cache.
        if (dirty) await this.persistIfCurrent(row, current);
      }
    } catch (error) {
      await this.recordFailure(first.id, error);
      throw error instanceof CacheDecryptionError ? reconnectRequired() : error;
    }
  }

  /**
   * Stores the connection after a successful administrator consent. Creates it, or (same Microsoft account and drive
   * only) refreshes it. A different account is refused here AND by a database trigger.
   */
  saveConnected(
    account: ConnectedAccount,
    layout: CentralLayout,
    scopes: string[],
    cacheSerialized: string,
    actorUserId: bigint,
  ): Promise<bigint> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CENTRAL_REFRESH_LOCK_KEY})`;
      const existing = await tx.central_connection.findFirst({ where: { is_deleted: false } });
      const now = new Date();
      const common = {
        home_account_id: account.homeAccountId,
        account_email: account.email,
        account_display_name: account.displayName,
        account_tenant_id: account.tenantId,
        account_type: account.accountType,
        root_folder_item_id: layout.rootItemId,
        users_folder_item_id: layout.usersFolderItemId,
        connection_status: 'connected',
        consented_scopes: scopes,
        last_auth_at: now,
        last_verified_at: now,
        last_error_code: null,
        last_error_at: null,
        cache_updated_at: now,
      };

      if (existing) {
        const sameAccount =
          existing.account_issuer === account.issuer &&
          existing.account_subject === account.subject &&
          existing.external_drive_id === layout.driveId;
        if (!sameAccount) throw new AuthFlowError('account_mismatch', 'central_account_differs');
        await tx.central_connection.update({
          where: { id: existing.id },
          data: {
            ...common,
            ...this.seal(existing.id, existing.account_subject, cacheSerialized),
            cache_revision: { increment: 1 },
            updated_by: actorUserId,
          },
        });
        this.accessValidUntil = 0;
        return existing.id;
      }

      const provider = await tx.storage_provider_types.findFirst({
        where: { code: ONEDRIVE_PROVIDER_CODE, is_deleted: false, is_active: true },
      });
      if (!provider) throw new Error('storage provider type "onedrive" is missing');
      // The row id is part of the encryption context, so it is reserved before the cache is encrypted.
      const [reserved] = await tx.$queryRaw<{ id: bigint }[]>`
        SELECT nextval(pg_get_serial_sequence('public.central_connection', 'id')) AS id`;
      if (!reserved) throw new Error('could not reserve a connection id');
      await tx.central_connection.create({
        data: {
          ...common,
          ...this.seal(reserved.id, account.subject, cacheSerialized),
          id: reserved.id,
          provider_type_id: provider.id,
          owner_user_id: account.ownerUserId,
          account_issuer: account.issuer,
          account_subject: account.subject,
          external_drive_id: layout.driveId,
          root_folder_path: 'FileForge-Central',
          created_by: actorUserId,
        },
      });
      this.accessValidUntil = 0;
      return reserved.id;
    });
  }

  // ----- internals -------------------------------------------------------------------------------------------------

  private async requireUsableRow() {
    const row = await this.findLive();
    if (!row) throw notConnected();
    // reauth_required / revoked / error: only an explicit administrator reconnect can fix these.
    if (
      row.connection_status === 'reauth_required' ||
      row.connection_status === 'revoked' ||
      row.connection_status === 'error'
    ) {
      throw reconnectRequired();
    }
    return row;
  }

  private toUsable(row: ConnectionRow): UsableCentralConnection {
    return {
      id: row.id,
      driveId: row.external_drive_id,
      rootItemId: row.root_folder_item_id,
      usersFolderItemId: row.users_folder_item_id,
      ownerUserId: row.owner_user_id,
    };
  }

  private seal(connectionId: bigint, accountSubject: string, plaintext: string) {
    const sealed = encryptCache(
      this.config.encryptionKey,
      plaintext,
      cacheAad(this.config.keyVersion, connectionId, accountSubject),
    );
    return {
      token_cache_ciphertext: bytes(sealed.ciphertext),
      token_cache_nonce: bytes(sealed.nonce),
      token_cache_auth_tag: bytes(sealed.authTag),
      encryption_key_version: this.config.keyVersion,
    };
  }

  /** Throws CacheDecryptionError for an unknown key version, a wrong key, or any modification of the stored data. */
  private decrypt(row: ConnectionRow): string {
    if (row.encryption_key_version !== this.config.keyVersion) throw new CacheDecryptionError();
    return decryptCache(
      this.config.encryptionKey,
      {
        ciphertext: Buffer.from(row.token_cache_ciphertext),
        nonce: Buffer.from(row.token_cache_nonce),
        authTag: Buffer.from(row.token_cache_auth_tag),
      },
      cacheAad(row.encryption_key_version, row.id, row.account_subject),
    );
  }

  /** Renews the access token under the cross-instance lock and returns the row as it is afterwards. */
  private refresh(): Promise<ConnectionRow> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CENTRAL_REFRESH_LOCK_KEY})`;
        // Re-read inside the lock: another request or instance may just have refreshed.
        const row = await tx.central_connection.findFirst({ where: { is_deleted: false }, orderBy: { id: 'asc' } });
        if (!row) throw notConnected();

        let current = this.decrypt(row);
        let dirty = false;
        const result = await this.identity.acquireTokenSilent({
          cache: {
            load: () => current,
            save: (serialized) => {
              current = serialized;
              dirty = true;
            },
          },
          homeAccountId: row.home_account_id,
          scopes: [FILES_SCOPE],
        });
        this.accessValidUntil = result.expiresOn?.getTime() ?? Date.now() + FALLBACK_ACCESS_LIFETIME_MS;
        if (!dirty) return row;

        const sealed = this.seal(row.id, row.account_subject, current);
        const updated = await tx.central_connection.updateMany({
          where: { id: row.id, cache_revision: row.cache_revision },
          data: { ...sealed, cache_revision: { increment: 1 }, cache_updated_at: new Date() },
        });
        if (updated.count !== 1) throw new Error('central token cache changed during refresh');
        return { ...row, ...sealed, cache_revision: row.cache_revision + 1n };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  }

  /** Saves a cache that MSAL changed during an operation, unless someone stored a newer one in the meantime. */
  private async persistIfCurrent(row: ConnectionRow, serialized: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CENTRAL_REFRESH_LOCK_KEY})`;
        const updated = await tx.central_connection.updateMany({
          where: { id: row.id, cache_revision: row.cache_revision },
          data: {
            ...this.seal(row.id, row.account_subject, serialized),
            cache_revision: { increment: 1 },
            cache_updated_at: new Date(),
          },
        });
        if (updated.count !== 1) this.logger.warn({ event: 'central_cache_write_skipped_newer_exists' });
      });
    } catch (error) {
      this.logger.error({ event: 'central_cache_persist_failed', error: describeError(error) });
    }
  }

  /** Remembers WHY the connection stopped working, so the admin page can say so. Never blocks the original error. */
  private async recordFailure(connectionId: bigint, error: unknown): Promise<void> {
    let status: string | null = null;
    let code: string | null = null;
    if (error instanceof CacheDecryptionError) {
      status = 'error';
      code = 'cache_decryption_failed';
    } else if (
      error instanceof MicrosoftApiError &&
      (error.kind === 'reauth_required' || error.kind === 'consent_required')
    ) {
      status = 'reauth_required';
      code = error.kind;
    }
    if (!status) return;
    this.accessValidUntil = 0;
    try {
      await this.prisma.central_connection.update({
        where: { id: connectionId },
        data: { connection_status: status, last_error_code: code, last_error_at: new Date() },
      });
    } catch (updateError) {
      this.logger.error({ event: 'central_status_update_failed', error: describeError(updateError) });
    }
    this.logger.warn({ event: 'central_connection_unusable', reason: code });
  }
}
