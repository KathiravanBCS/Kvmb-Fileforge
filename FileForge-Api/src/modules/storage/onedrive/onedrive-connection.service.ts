import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthFlowError } from '../../../common/exceptions/auth-flow.error';
import type { OAuthTransaction, SessionIdentity, SessionUser } from '../../../common/types/session.types';
import { describeError } from '../../../common/utils/logging.util';
import { PrismaService } from '../../../prisma/prisma.service';
import { GraphClient, type GraphRequestContext } from '../../microsoft/graph/graph.client';
import { MicrosoftIdentityService } from '../../microsoft/identity/microsoft-identity.service';
import { OAuthTransactionStore, type OAuthSessionHolder } from '../../microsoft/identity/oauth-transaction.store';
import {
  sessionTokenCache,
  stagedTokenCache,
  type TokenCacheHolder,
} from '../../microsoft/identity/session-token-cache';
import { MicrosoftApiError } from '../../microsoft/microsoft.errors';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import { itemPath } from './onedrive-paths';
import {
  CONNECT_SCOPES,
  FILES_SCOPE,
  MANAGE_ROLES,
  MODULE_FOLDERS,
  ONEDRIVE_PROVIDER_CODE,
  ROOT_FOLDER_NAME,
} from './onedrive.constants';
import type {
  ConnectionSummary,
  GraphDriveItem,
  OneDriveStatus,
  OneDriveStatusCode,
  UsableConnection,
} from './onedrive.types';

/** The slice of the express session these operations use. */
export type StorageSession = TokenCacheHolder &
  OAuthSessionHolder & { identity?: SessionIdentity; homeAccountId?: string };

type ConnectionRow = NonNullable<Awaited<ReturnType<OneDriveConnectionService['findOwned']>>>;

const FOLDER_SCOPES = { scopes: [FILES_SCOPE] };

/**
 * A user's OneDrive connection to a workspace (connections + folder_mappings).
 *
 * The connection row stores NO tokens: Microsoft tokens live only in the owner's server-side session, and
 * `secret_reference` stays NULL. A connection can therefore only be used by its owner, in a session of theirs
 * that still holds the tokens: another workspace member cannot reach someone else's personal OneDrive.
 */
@Injectable()
export class OneDriveConnectionService {
  private readonly logger = new Logger(OneDriveConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: MicrosoftIdentityService,
    private readonly graph: GraphClient,
    private readonly transactions: OAuthTransactionStore,
    private readonly workspaces: WorkspacesService,
  ) {}

  /** The workspace's active OneDrive connection owned by this user (never another user's). */
  async findOwned(workspaceId: bigint, userId: bigint) {
    return this.prisma.connections.findFirst({
      where: {
        workspace_id: workspaceId,
        owner_user_id: userId,
        is_deleted: false,
        is_active: true,
        storage_provider_types: { code: ONEDRIVE_PROVIDER_CODE },
      },
      orderBy: { id: 'asc' },
    });
  }

  private async existsForOthers(workspaceId: bigint, userId: bigint): Promise<boolean> {
    const other = await this.prisma.connections.findFirst({
      where: {
        workspace_id: workspaceId,
        is_deleted: false,
        is_active: true,
        storage_provider_types: { code: ONEDRIVE_PROVIDER_CODE },
        OR: [{ owner_user_id: null }, { owner_user_id: { not: userId } }],
      },
      select: { id: true },
    });
    return other !== null;
  }

  /**
   * The connection every file operation is built from. Fails closed: no connection, someone else's connection,
   * or a connection without drive/root ids or marked revoked/error all refuse the operation.
   */
  async requireUsable(workspaceId: string, user: SessionUser): Promise<UsableConnection> {
    const workspace = BigInt(workspaceId);
    const owner = BigInt(user.id);
    const connection = await this.findOwned(workspace, owner);

    if (!connection) {
      throw (await this.existsForOthers(workspace, owner))
        ? new ForbiddenException({
            code: 'ONEDRIVE_CONNECTION_NOT_OWNED',
            message: 'This workspace uses another member’s OneDrive. Only its owner can use it.',
          })
        : new NotFoundException({
            code: 'ONEDRIVE_NOT_CONNECTED',
            message: 'OneDrive is not connected for this workspace.',
          });
    }
    if (!this.isUsable(connection)) {
      throw new ConflictException({
        code: 'ONEDRIVE_CONNECTION_INVALID',
        message: 'The OneDrive connection needs to be set up again.',
      });
    }
    return {
      id: connection.id,
      workspaceId: workspace,
      driveId: connection.external_drive_id as string,
      rootItemId: connection.root_folder_item_id as string,
    };
  }

  private isUsable(connection: ConnectionRow): boolean {
    return (
      !!connection.external_drive_id &&
      !!connection.root_folder_item_id &&
      connection.connection_status !== 'revoked' &&
      connection.connection_status !== 'error'
    );
  }

  /** What the UI shows. Checks the stored tokens without calling Graph. */
  async getStatus(workspaceId: string, user: SessionUser, session: StorageSession): Promise<OneDriveStatus> {
    const workspace = BigInt(workspaceId);
    const owner = BigInt(user.id);
    const connection = await this.findOwned(workspace, owner);

    if (!connection) {
      return {
        status: (await this.existsForOthers(workspace, owner)) ? 'owned_by_other_user' : 'not_connected',
        connection: null,
      };
    }
    const summary = this.summarize(connection);
    if (!this.isUsable(connection)) return { status: 'error', connection: summary };
    return { status: await this.checkTokens(session), connection: summary };
  }

  private async checkTokens(session: StorageSession): Promise<OneDriveStatusCode> {
    if (!session.homeAccountId) return 'reauth_required';
    try {
      await this.identity.acquireTokenSilent({
        cache: sessionTokenCache(session),
        homeAccountId: session.homeAccountId,
        scopes: [FILES_SCOPE],
      });
      return 'connected';
    } catch (error) {
      if (error instanceof MicrosoftApiError) {
        if (error.kind === 'consent_required') return 'consent_required';
        if (error.kind === 'reauth_required') return 'reauth_required';
        return 'error';
      }
      throw error;
    }
  }

  private summarize(connection: ConnectionRow): ConnectionSummary {
    return {
      id: connection.id.toString(),
      name: connection.name,
      rootFolderPath: connection.root_folder_path,
      lastAuthAt: connection.last_auth_at?.toISOString() ?? null,
      lastVerifiedAt: connection.last_verified_at?.toISOString() ?? null,
    };
  }

  /**
   * Starts Connect OneDrive: incremental consent for Files.ReadWrite, for the signed-in Microsoft account.
   * The caller has already been authorized for the workspace (owner/admin).
   */
  async startConnect(workspaceId: string, user: SessionUser, session: StorageSession): Promise<string> {
    if (!session.identity || !session.homeAccountId) {
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
      purpose: 'connect_onedrive',
      workspaceId,
    });
    return authorization.url;
  }

  /**
   * Finishes Connect OneDrive after Microsoft redirected back. Everything is re-checked here, because the browser
   * took a detour through Microsoft: session, workspace role, and that the consenting account is the signed-in one.
   */
  async completeConnect(session: StorageSession, code: string, transaction: OAuthTransaction): Promise<void> {
    const user = session.user;
    const sessionIdentity = session.identity;
    const workspaceId = transaction.workspaceId;
    if (!user || !sessionIdentity || !workspaceId) throw new AuthFlowError('session_expired', 'no_signed_in_session');

    const membership = await this.workspaces.findActiveMembership(user.id, workspaceId);
    if (!membership || !MANAGE_ROLES.includes(membership.roleCode)) {
      throw new AuthFlowError('workspace_forbidden', 'not_owner_or_admin');
    }

    // Tokens go to a staging cache first: they are only merged into the session once the account is verified.
    const staged = stagedTokenCache(sessionTokenCache(session));
    let redeemed: Awaited<ReturnType<MicrosoftIdentityService['redeemAuthorizationCode']>>;
    try {
      redeemed = await this.identity.redeemAuthorizationCode({
        code,
        codeVerifier: transaction.codeVerifier,
        nonce: transaction.nonce,
        scopes: CONNECT_SCOPES,
        cache: staged.store,
      });
    } catch (error) {
      throw error instanceof AuthFlowError
        ? error
        : new AuthFlowError('login_failed', 'token_exchange_failed', { cause: error });
    }

    // The user may have been signed in to several Microsoft accounts: it must be the same account as at sign-in.
    if (redeemed.identity.issuer !== sessionIdentity.issuer || redeemed.identity.subject !== sessionIdentity.subject) {
      throw new AuthFlowError('account_mismatch', 'different_microsoft_account');
    }
    staged.commit();
    const homeAccountId = redeemed.identity.homeAccountId ?? session.homeAccountId;
    if (!homeAccountId) throw new AuthFlowError('session_expired', 'no_home_account');
    session.homeAccountId = homeAccountId;

    const context: GraphRequestContext = { cache: sessionTokenCache(session), homeAccountId };
    let layout: Awaited<ReturnType<OneDriveConnectionService['ensureLayout']>>;
    try {
      layout = await this.ensureLayout(context);
    } catch (error) {
      throw this.mapLayoutError(error);
    }

    try {
      await this.persist(workspaceId, user, layout, redeemed.scopes);
    } catch (error) {
      this.logger.error({ event: 'onedrive_connection_not_saved', error: describeError(error) });
      throw new AuthFlowError('service_unavailable', 'connection_not_saved', { cause: error });
    }
    this.logger.log({ event: 'onedrive_connected', workspaceId });
  }

  private mapLayoutError(error: unknown): AuthFlowError {
    if (error instanceof MicrosoftApiError) {
      if (error.kind === 'consent_required')
        return new AuthFlowError('consent_required', 'consent_required', { cause: error });
      if (error.kind === 'reauth_required')
        return new AuthFlowError('session_expired', 'reauth_required', { cause: error });
    }
    return new AuthFlowError('onedrive_unavailable', 'folder_setup_failed', { cause: error });
  }

  /** Finds (or creates) the FileForge root and the module folders. Nothing else in the drive is touched. */
  private async ensureLayout(context: GraphRequestContext) {
    const drive = await this.graph.request<{ id?: string }>(context, '/me/drive', FOLDER_SCOPES);
    if (!drive?.id) throw new MicrosoftApiError('unknown');
    const driveId = drive.id;
    const drivePath = `/drives/${encodeURIComponent(driveId)}`;

    const root = await this.ensureFolder(
      context,
      driveId,
      `${drivePath}/root:/${encodeURIComponent(ROOT_FOLDER_NAME)}`,
      `${drivePath}/root/children`,
      ROOT_FOLDER_NAME,
    );

    const folders: { moduleCode: string; folderName: string; itemId: string }[] = [];
    for (const { folderName, moduleCode } of MODULE_FOLDERS) {
      const item = await this.ensureFolder(
        context,
        driveId,
        itemPath(driveId, root.id, [folderName]),
        itemPath(driveId, root.id, [], '/children'),
        folderName,
      );
      folders.push({ moduleCode, folderName, itemId: item.id });
    }
    return { driveId, rootItemId: root.id, folders };
  }

  private async ensureFolder(
    context: GraphRequestContext,
    driveId: string,
    getPath: string,
    childrenPath: string,
    name: string,
  ): Promise<GraphDriveItem> {
    const read = () => this.graph.request<GraphDriveItem>(context, getPath, FOLDER_SCOPES);
    let item: GraphDriveItem | undefined;
    try {
      item = await read();
    } catch (error) {
      if (!(error instanceof MicrosoftApiError) || error.kind !== 'not_found') throw error;
      try {
        item = await this.graph.request<GraphDriveItem>(context, childrenPath, {
          ...FOLDER_SCOPES,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
        });
      } catch (createError) {
        // Created by someone else a moment ago: that is fine, read it.
        if (!(createError instanceof MicrosoftApiError) || createError.kind !== 'conflict') throw createError;
        item = await read();
      }
    }
    // Something that is not a folder (e.g. a FILE named "FileForge"), or not in this drive, is never adopted.
    if (!item?.id || !item.folder || (item.parentReference?.driveId && item.parentReference.driveId !== driveId)) {
      throw new MicrosoftApiError('unknown');
    }
    return item;
  }

  private async persist(
    workspaceIdText: string,
    user: SessionUser,
    layout: {
      driveId: string;
      rootItemId: string;
      folders: { moduleCode: string; folderName: string; itemId: string }[];
    },
    scopes: string[],
  ): Promise<void> {
    const workspaceId = BigInt(workspaceIdText);
    const userId = BigInt(user.id);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const provider = await tx.storage_provider_types.findFirst({
        where: { code: ONEDRIVE_PROVIDER_CODE, is_deleted: false, is_active: true },
      });
      if (!provider) throw new Error('storage provider type "onedrive" is missing');

      const fields = {
        auth_mode: 'delegated',
        connection_status: 'connected',
        external_drive_id: layout.driveId,
        root_folder_item_id: layout.rootItemId,
        root_folder_path: ROOT_FOLDER_NAME,
        consented_scopes: scopes,
        last_auth_at: now,
        last_verified_at: now,
        is_active: true,
        updated_by: userId,
        // secret_reference is deliberately never set: Microsoft tokens are not stored in PostgreSQL.
      };

      // One connection per (workspace, owner): connecting again updates it instead of adding another.
      const existing = await tx.connections.findFirst({
        where: { workspace_id: workspaceId, owner_user_id: userId, provider_type_id: provider.id, is_deleted: false },
      });
      let connectionId: bigint;
      if (existing) {
        await tx.connections.update({ where: { id: existing.id }, data: fields });
        connectionId = existing.id;
      } else {
        const hasDefault = await tx.connections.findFirst({
          where: { workspace_id: workspaceId, is_default: true, is_deleted: false },
          select: { id: true },
        });
        const created = await tx.connections.create({
          data: {
            ...fields,
            workspace_id: workspaceId,
            provider_type_id: provider.id,
            name: 'OneDrive',
            config: {},
            owner_user_id: userId,
            is_default: !hasDefault,
            created_by: userId,
          },
        });
        connectionId = created.id;
      }

      for (const { moduleCode, folderName, itemId } of layout.folders) {
        const mapping = {
          folder_name: folderName,
          external_folder_item_id: itemId,
          // Relative to the FileForge root: the same form the API accepts from the browser.
          relative_path: folderName,
          is_active: true,
        };
        const row = await tx.folder_mappings.findFirst({
          where: { connection_id: connectionId, module_code: moduleCode, is_deleted: false },
        });
        if (row) {
          await tx.folder_mappings.update({ where: { id: row.id }, data: { ...mapping, updated_by: userId } });
        } else {
          await tx.folder_mappings.create({
            data: {
              ...mapping,
              workspace_id: workspaceId,
              connection_id: connectionId,
              module_code: moduleCode,
              created_by: userId,
            },
          });
        }
      }
    });
  }
}
