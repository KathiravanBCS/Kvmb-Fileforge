import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';

import { AuthFlowError } from '../../common/exceptions/auth-flow.error';
import type { OAuthTransaction, SessionUser } from '../../common/types/session.types';
import { describeError } from '../../common/utils/logging.util';
import { PrismaService } from '../../prisma/prisma.service';
import { MicrosoftIdentityService } from '../microsoft/identity/microsoft-identity.service';
import type { TokenCacheStore } from '../microsoft/identity/microsoft-identity.types';
import { OAuthTransactionStore } from '../microsoft/identity/oauth-transaction.store';
import { MicrosoftApiError } from '../microsoft/microsoft.errors';
import type { StorageSession } from '../storage/onedrive/onedrive-connection.service';
import { CONNECT_SCOPES } from '../storage/onedrive/onedrive.constants';
import { CentralStorageAccessService } from './central-storage-access.service';
import { CentralStorageAuditService } from './central-storage-audit.service';
import { CentralStorageOneDriveService } from './central-storage-onedrive.service';
import { ENTITY_CENTRAL_CONNECTION } from './central-storage.constants';
import { CentralTokenVault } from './central-token-vault.service';
import type { Actor, ConnectedAccount } from './types/central-storage.types';

/** What the administrator page shows. Never a token, never the encrypted cache, never a OneDrive id. */
export interface CentralConnectionStatus {
  status: 'not_connected' | 'unverified' | 'connected' | 'reauth_required' | 'revoked' | 'error';
  usable: boolean;
  rootFolderPath: string | null;
  account: { displayName: string | null; email: string | null; accountType: string } | null;
  lastAuthAt: string | null;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
  quota: { total: number | null; used: number | null; remaining: number | null; state: string | null } | null;
}

/**
 * The administrator's central OneDrive connection: start, complete (Microsoft redirect), status and health check.
 *
 * Authorization is checked at both ends: the route requires a system administrator, and completing the redirect checks
 * AGAIN (the browser took a detour through Microsoft). The connected Microsoft account must be exactly the account the
 * administrator signed in with (issuer + subject, never e-mail) AND an identity linked to that user in core.user_identities;
 * a different account can neither create the connection nor replace an existing one (also enforced by a database trigger).
 * The tokens never enter the browser's session: they go straight into the encrypted vault.
 */
@Injectable()
export class CentralConnectionService {
  private readonly logger = new Logger(CentralConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: MicrosoftIdentityService,
    private readonly transactions: OAuthTransactionStore,
    private readonly vault: CentralTokenVault,
    private readonly storage: CentralStorageOneDriveService,
    private readonly access: CentralStorageAccessService,
    private readonly audit: CentralStorageAuditService,
  ) {}

  async getStatus(): Promise<CentralConnectionStatus> {
    const row = await this.vault.findLive();
    if (!row) {
      return {
        status: 'not_connected',
        usable: false,
        rootFolderPath: null,
        account: null,
        lastAuthAt: null,
        lastVerifiedAt: null,
        lastErrorCode: null,
        quota: null,
      };
    }
    const hasQuota = row.quota_checked_at !== null;
    return {
      status: row.connection_status as CentralConnectionStatus['status'],
      usable: row.connection_status === 'connected',
      rootFolderPath: row.root_folder_path,
      account: { displayName: row.account_display_name, email: row.account_email, accountType: row.account_type },
      lastAuthAt: row.last_auth_at?.toISOString() ?? null,
      lastVerifiedAt: row.last_verified_at?.toISOString() ?? null,
      lastErrorCode: row.last_error_code,
      quota: hasQuota
        ? {
            total: row.quota_total_bytes === null ? null : Number(row.quota_total_bytes),
            used: row.quota_used_bytes === null ? null : Number(row.quota_used_bytes),
            remaining: row.quota_remaining_bytes === null ? null : Number(row.quota_remaining_bytes),
            state: row.quota_state,
          }
        : null,
    };
  }

  /** Step 1: the Microsoft URL for `Files.ReadWrite` consent. The browser must navigate to it. */
  async startConnect(actor: Actor, user: SessionUser, session: StorageSession): Promise<string> {
    await this.access.requireSystemAdmin(actor.userId);
    if (!session.identity) {
      throw new UnauthorizedException({
        code: 'MICROSOFT_REAUTH_REQUIRED',
        message: 'Your Microsoft session has to be renewed. Please sign in again.',
      });
    }
    const authorization = await this.identity.createAuthorizationRequest({
      scopes: CONNECT_SCOPES,
      loginHint: user.email,
    });
    this.transactions.add(session, authorization.state, {
      codeVerifier: authorization.codeVerifier,
      nonce: authorization.nonce,
      purpose: 'connect_central_storage',
    });
    return authorization.url;
  }

  /** Step 2: Microsoft redirected back with a code. Everything is re-verified before anything is stored. */
  async completeConnect(session: StorageSession, code: string, transaction: OAuthTransaction): Promise<void> {
    const user = session.user;
    const sessionIdentity = session.identity;
    if (!user || !sessionIdentity) throw new AuthFlowError('session_expired', 'no_signed_in_session');
    const userId = BigInt(user.id);

    if (!(await this.access.isSystemAdmin(userId)))
      throw new AuthFlowError('central_storage_forbidden', 'not_system_admin');
    // The Microsoft identity of this session must really be one of THIS user's identities.
    const linked = await this.prisma.user_identities.findFirst({
      where: {
        user_id: userId,
        provider: 'microsoft',
        issuer: sessionIdentity.issuer,
        subject: sessionIdentity.subject,
        is_deleted: false,
      },
      select: { id: true },
    });
    if (!linked) throw new AuthFlowError('account_mismatch', 'session_identity_not_linked');

    // Tokens go to a private in-memory cache, NOT into the browser session, and are only stored once verified.
    let serialized = '';
    const cache: TokenCacheStore = {
      load: () => (serialized === '' ? undefined : serialized),
      save: (value) => {
        serialized = value;
      },
    };
    let redeemed: Awaited<ReturnType<MicrosoftIdentityService['redeemAuthorizationCode']>>;
    try {
      redeemed = await this.identity.redeemAuthorizationCode({
        code,
        codeVerifier: transaction.codeVerifier,
        nonce: transaction.nonce,
        scopes: CONNECT_SCOPES,
        cache,
      });
    } catch (error) {
      throw error instanceof AuthFlowError
        ? error
        : new AuthFlowError('login_failed', 'token_exchange_failed', { cause: error });
    }

    // The person may be signed in to several Microsoft accounts: it must be the one they signed in with.
    if (redeemed.identity.issuer !== sessionIdentity.issuer || redeemed.identity.subject !== sessionIdentity.subject) {
      throw new AuthFlowError('account_mismatch', 'different_microsoft_account');
    }
    const homeAccountId = redeemed.identity.homeAccountId;
    if (!homeAccountId) throw new AuthFlowError('session_expired', 'no_home_account');

    let layout: Awaited<ReturnType<CentralStorageOneDriveService['ensureLayout']>>;
    try {
      layout = await this.storage.ensureLayout({ cache, homeAccountId });
    } catch (error) {
      throw this.mapLayoutError(error);
    }

    const account: ConnectedAccount = {
      ownerUserId: userId,
      issuer: redeemed.identity.issuer,
      subject: redeemed.identity.subject,
      tenantId: redeemed.identity.tenantId,
      accountType: redeemed.identity.accountType,
      homeAccountId,
      email: redeemed.identity.email,
      displayName: redeemed.identity.displayName,
    };
    let connectionId: bigint;
    try {
      connectionId = await this.vault.saveConnected(account, layout, redeemed.scopes, serialized, userId);
    } catch (error) {
      if (error instanceof AuthFlowError) throw error;
      this.logger.error({ event: 'central_connection_not_saved', error: describeError(error) });
      throw new AuthFlowError('central_storage_unavailable', 'connection_not_saved', { cause: error });
    }

    await this.audit
      .record({ userId, isAdmin: true }, 'central_storage.connection.connected', {
        type: ENTITY_CENTRAL_CONNECTION,
        id: connectionId,
      })
      .catch((error: unknown) => this.logger.error({ event: 'central_audit_failed', error: describeError(error) }));
    this.logger.log({ event: 'central_storage_connected' });
  }

  /** Health check: calls Graph, refreshes the quota and the status. Reports a lost authorization instead of hiding it. */
  async verify(actor: Actor): Promise<CentralConnectionStatus> {
    await this.access.requireSystemAdmin(actor.userId);
    const row = await this.vault.findLive();
    if (row) {
      try {
        const quota = await this.storage.health();
        await this.prisma.central_connection.update({
          where: { id: row.id },
          data: {
            connection_status: 'connected',
            last_verified_at: new Date(),
            last_error_code: null,
            last_error_at: null,
            quota_total_bytes: quota.total === null ? null : BigInt(quota.total),
            quota_used_bytes: quota.used === null ? null : BigInt(quota.used),
            quota_remaining_bytes: quota.remaining === null ? null : BigInt(quota.remaining),
            quota_state: quota.state,
            quota_checked_at: new Date(),
            updated_by: actor.userId,
          },
        });
      } catch (error) {
        // The vault already recorded a lost authorization / unreadable cache. Anything else is remembered here.
        const code = (error as { response?: { code?: unknown } }).response?.code;
        await this.prisma.central_connection
          .updateMany({
            where: { id: row.id, connection_status: { in: ['connected', 'unverified'] } },
            data: {
              last_error_code: typeof code === 'string' ? code.slice(0, 60) : 'HEALTH_CHECK_FAILED',
              last_error_at: new Date(),
            },
          })
          .catch(() => undefined);
        this.logger.warn({ event: 'central_health_check_failed', error: describeError(error) });
      }
    }
    await this.audit
      .record(actor, 'central_storage.connection.verified', { type: ENTITY_CENTRAL_CONNECTION, id: row?.id ?? null })
      .catch((error: unknown) => this.logger.error({ event: 'central_audit_failed', error: describeError(error) }));
    return this.getStatus();
  }

  private mapLayoutError(error: unknown): AuthFlowError {
    if (error instanceof MicrosoftApiError) {
      if (error.kind === 'consent_required')
        return new AuthFlowError('consent_required', 'consent_required', { cause: error });
      if (error.kind === 'reauth_required')
        return new AuthFlowError('session_expired', 'reauth_required', { cause: error });
    }
    return new AuthFlowError('central_storage_unavailable', 'folder_setup_failed', { cause: error });
  }
}
