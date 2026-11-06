import { randomBytes } from 'node:crypto';

import { HttpException, Logger } from '@nestjs/common';

import { AuthFlowError } from '../../common/exceptions/auth-flow.error';
import type { OAuthTransaction } from '../../common/types/session.types';
import type { PrismaService } from '../../prisma/prisma.service';
import { centralWorld, USER } from '../../testing/central-fixtures';
import type { MicrosoftIdentityService } from '../microsoft/identity/microsoft-identity.service';
import type { OAuthTransactionStore } from '../microsoft/identity/oauth-transaction.store';
import { MicrosoftApiError } from '../microsoft/microsoft.errors';
import type { StorageSession } from '../storage/onedrive/onedrive-connection.service';
import { CONNECT_SCOPES } from '../storage/onedrive/onedrive.constants';
import { CentralConnectionService } from './central-connection.service';
import { CentralStorageAccessService } from './central-storage-access.service';
import { CentralStorageAuditService } from './central-storage-audit.service';
import type { CentralStorageOneDriveService } from './central-storage-onedrive.service';
import { CentralTokenVault } from './central-token-vault.service';

const ISSUER = 'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0';
const LAYOUT = { driveId: 'drive-1', rootItemId: 'root-1', usersFolderItemId: 'users-1' };
const TX: OAuthTransaction = {
  codeVerifier: 'verifier',
  nonce: 'nonce',
  createdAt: Date.now(),
  purpose: 'connect_central_storage',
};
const SECRET_CACHE = JSON.stringify({ RefreshToken: { secret: 'REFRESH-TOKEN-SECRET-VALUE' } });
const NEW_ADMIN = 5n;

const msIdentity = (subject: string, over: Record<string, unknown> = {}) => ({
  provider: 'microsoft',
  issuer: ISSUER,
  subject,
  providerUserId: `sub-${subject}`,
  tenantId: '9188040d-6c67-4c5b-b112-36a304b66dad',
  accountType: 'personal',
  homeAccountId: `home-${subject}`,
  email: 'admin@example.com',
  displayName: 'Admin',
  loginHint: 'admin@example.com',
  ...over,
});

function setup() {
  const world = centralWorld();
  world.tables['storage_provider_types']?.seed({ id: 3n, code: 'onedrive' });
  world.tables['user_identities']?.seed({ user_id: USER.admin, issuer: ISSUER, subject: 'oid-admin' });
  world.tables['user_identities']?.seed({ user_id: USER.alice, issuer: ISSUER, subject: 'oid-alice' });
  // A second administrator, to prove one administrator cannot take over another's connection.
  world.tables['users']?.seed({ id: NEW_ADMIN, email: 'admin2@example.com' });
  world.tables['system_admins']?.seed({ user_id: NEW_ADMIN });
  world.tables['user_identities']?.seed({ user_id: NEW_ADMIN, issuer: ISSUER, subject: 'oid-admin-2' });

  const prisma = world.prisma as unknown as PrismaService;
  const identity = {
    createAuthorizationRequest: jest.fn().mockResolvedValue({
      url: 'https://login.microsoftonline.com/authorize?x',
      state: 'S'.repeat(43),
      nonce: 'n',
      codeVerifier: 'v',
    }),
    redeemAuthorizationCode: jest.fn(async ({ cache }: { cache: { save(s: string): void } }) => {
      cache.save(SECRET_CACHE);
      return { identity: msIdentity('oid-admin'), tokenCache: undefined, scopes: ['openid', 'Files.ReadWrite'] };
    }),
    acquireTokenSilent: jest.fn(),
  };
  const transactions = { add: jest.fn() };
  const vault = new CentralTokenVault(prisma, identity as unknown as MicrosoftIdentityService, {
    encryptionKey: randomBytes(32),
    keyVersion: 1,
  });
  const storage = { ensureLayout: jest.fn().mockResolvedValue(LAYOUT), health: jest.fn() };
  const access = new CentralStorageAccessService(prisma);
  const service = new CentralConnectionService(
    prisma,
    identity as unknown as MicrosoftIdentityService,
    transactions as unknown as OAuthTransactionStore,
    vault,
    storage as unknown as CentralStorageOneDriveService,
    access,
    new CentralStorageAuditService(prisma),
  );
  const session = (userId: bigint, subject: string): StorageSession => ({
    user: { id: userId.toString(), email: 'admin@example.com', displayName: null },
    identity: { issuer: ISSUER, subject },
    msalCache: 'SESSION-OWN-CACHE',
    homeAccountId: 'session-home',
    cookie: {},
  });
  return {
    ...world,
    identity,
    transactions,
    storage,
    service,
    vault,
    session,
    connection: world.tables['central_connection'],
    events: world.tables['events'],
    adminActor: () => access.adminActor({ id: '1', email: 'admin@example.com', displayName: null }),
  };
}

const flow = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AuthFlowError) return { flow: error.code, reason: error.reason };
    if (error instanceof HttpException)
      return { status: error.getStatus(), code: (error.getResponse() as { code?: string }).code };
    throw error;
  }
  return undefined;
};

beforeAll(() => {
  for (const level of ['log', 'warn', 'error'] as const)
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe('starting the connection', () => {
  it('only a system administrator can start it, and only for the Microsoft account they are signed in with', async () => {
    const { service, transactions, identity, session, adminActor } = setup();
    const url = await service.startConnect(
      await adminActor(),
      { id: '1', email: 'admin@example.com', displayName: null },
      session(USER.admin, 'oid-admin'),
    );

    expect(url).toContain('login.microsoftonline.com');
    expect(identity.createAuthorizationRequest).toHaveBeenCalledWith({
      scopes: CONNECT_SCOPES,
      loginHint: 'admin@example.com',
    });
    expect(CONNECT_SCOPES).toContain('Files.ReadWrite');
    expect(transactions.add).toHaveBeenCalledWith(expect.anything(), 'S'.repeat(43), {
      codeVerifier: 'v',
      nonce: 'n',
      purpose: 'connect_central_storage', // decided by the server, never by the browser
    });
  });

  it('an ordinary user (or a workspace owner) cannot even start it', async () => {
    const { service, transactions, session } = setup();
    const aliceActor = { userId: USER.alice, isAdmin: true as const }; // even a forged administrator actor is re-checked
    expect(
      await flow(
        service.startConnect(
          aliceActor,
          { id: '2', email: 'a@example.com', displayName: null },
          session(USER.alice, 'oid-alice'),
        ),
      ),
    ).toMatchObject({ status: 403, code: 'SYSTEM_ADMIN_REQUIRED' });
    expect(transactions.add).not.toHaveBeenCalled();
  });

  it('asks the administrator to sign in again when their session has no Microsoft identity', async () => {
    const { service, session, adminActor } = setup();
    const noIdentity = { ...session(USER.admin, 'oid-admin'), identity: undefined };
    expect(
      await flow(
        service.startConnect(await adminActor(), { id: '1', email: 'a@x.com', displayName: null }, noIdentity),
      ),
    ).toMatchObject({ status: 401, code: 'MICROSOFT_REAUTH_REQUIRED' });
  });
});

describe('completing the connection (Microsoft redirected back)', () => {
  it('stores the designated account, encrypted, WITHOUT touching the browser session’s own tokens', async () => {
    const { service, session, connection, identity, storage, events } = setup();
    const adminSession = session(USER.admin, 'oid-admin');

    await service.completeConnect(adminSession, 'auth-code', TX);

    expect(connection.rows).toHaveLength(1);
    const row = connection.rows[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      owner_user_id: USER.admin,
      account_issuer: ISSUER,
      account_subject: 'oid-admin',
      home_account_id: 'home-oid-admin',
      connection_status: 'connected',
      external_drive_id: 'drive-1',
      root_folder_item_id: 'root-1',
      users_folder_item_id: 'users-1',
      root_folder_path: 'FileForge-Central',
    });
    const stored = Buffer.concat(
      ['token_cache_ciphertext', 'token_cache_nonce', 'token_cache_auth_tag'].map((k) =>
        Buffer.from(row[k] as Uint8Array),
      ),
    );
    expect(stored.toString('latin1')).not.toContain('REFRESH-TOKEN-SECRET');
    expect(adminSession.msalCache).toBe('SESSION-OWN-CACHE'); // the central tokens never enter the browser session
    expect(identity.redeemAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'auth-code', codeVerifier: 'verifier', nonce: 'nonce', scopes: CONNECT_SCOPES }),
    );
    expect(storage.ensureLayout).toHaveBeenCalledTimes(1);
    expect(events.rows[0]).toMatchObject({
      action: 'central_storage.connection.connected',
      actor_user_id: USER.admin,
      entity_type_id: 11n,
    });
  });

  it('reconnecting the same account refreshes the existing connection instead of adding another', async () => {
    const { service, session, connection } = setup();
    await service.completeConnect(session(USER.admin, 'oid-admin'), 'code-1', TX);
    await service.completeConnect(session(USER.admin, 'oid-admin'), 'code-2', TX);
    expect(connection.rows).toHaveLength(1);
    expect((connection.rows[0] as Record<string, unknown>)['cache_revision']).toBe(2n);
  });

  describe('refuses, and stores nothing, when …', () => {
    it('the signed-in user is not a system administrator', async () => {
      const { service, session, connection, identity } = setup();
      expect(await flow(service.completeConnect(session(USER.alice, 'oid-alice'), 'c', TX))).toEqual({
        flow: 'central_storage_forbidden',
        reason: 'not_system_admin',
      });
      expect(identity.redeemAuthorizationCode).not.toHaveBeenCalled(); // the code was not even exchanged
      expect(connection.rows).toHaveLength(0);
    });

    it('the administrator grant was revoked while they were at Microsoft', async () => {
      const { service, session, connection, tables, identity } = setup();
      (tables['system_admins']?.rows[0] as Record<string, unknown>)['is_active'] = false;
      expect(await flow(service.completeConnect(session(USER.admin, 'oid-admin'), 'c', TX))).toMatchObject({
        flow: 'central_storage_forbidden',
      });
      expect(identity.redeemAuthorizationCode).not.toHaveBeenCalled();
      expect(connection.rows).toHaveLength(0);
    });

    it('there is no signed-in session', async () => {
      const { service, session, connection } = setup();
      expect(
        await flow(service.completeConnect({ ...session(USER.admin, 'oid-admin'), user: undefined }, 'c', TX)),
      ).toMatchObject({ flow: 'session_expired' });
      expect(
        await flow(service.completeConnect({ ...session(USER.admin, 'oid-admin'), identity: undefined }, 'c', TX)),
      ).toMatchObject({ flow: 'session_expired' });
      expect(connection.rows).toHaveLength(0);
    });

    it('the session’s Microsoft identity is not one of THIS user’s identities (a tampered or stale session)', async () => {
      const { service, session, connection, identity } = setup();
      expect(await flow(service.completeConnect(session(USER.admin, 'oid-someone-else'), 'c', TX))).toEqual({
        flow: 'account_mismatch',
        reason: 'session_identity_not_linked',
      });
      expect(identity.redeemAuthorizationCode).not.toHaveBeenCalled();
      expect(connection.rows).toHaveLength(0);
    });

    it('the administrator consented with a DIFFERENT Microsoft account than the one they signed in with', async () => {
      const { service, session, connection, identity, storage } = setup();
      identity.redeemAuthorizationCode.mockImplementationOnce(
        async ({ cache }: { cache: { save(s: string): void } }) => {
          cache.save(SECRET_CACHE);
          return { identity: msIdentity('oid-some-other-account'), tokenCache: undefined, scopes: [] };
        },
      );
      expect(await flow(service.completeConnect(session(USER.admin, 'oid-admin'), 'c', TX))).toEqual({
        flow: 'account_mismatch',
        reason: 'different_microsoft_account',
      });
      expect(storage.ensureLayout).not.toHaveBeenCalled(); // nothing was done in that account's OneDrive
      expect(connection.rows).toHaveLength(0);
    });

    it('the e-mail matches but the identity does not (matching is by issuer + subject, never e-mail)', async () => {
      const { service, session, connection, identity } = setup();
      identity.redeemAuthorizationCode.mockImplementationOnce(
        async ({ cache }: { cache: { save(s: string): void } }) => {
          cache.save(SECRET_CACHE);
          return {
            identity: msIdentity('oid-impostor', { email: 'admin@example.com' }),
            tokenCache: undefined,
            scopes: [],
          };
        },
      );
      expect(await flow(service.completeConnect(session(USER.admin, 'oid-admin'), 'c', TX))).toMatchObject({
        flow: 'account_mismatch',
      });
      expect(connection.rows).toHaveLength(0);
    });

    it('a central connection already exists for another account: it can NOT be replaced, even by another administrator', async () => {
      const { service, session, connection } = setup();
      await service.completeConnect(session(USER.admin, 'oid-admin'), 'c1', TX);
      const before = JSON.stringify(connection.rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

      const { identity } = {
        identity: (service as unknown as { identity: { redeemAuthorizationCode: jest.Mock } }).identity,
      };
      identity.redeemAuthorizationCode.mockImplementationOnce(
        async ({ cache }: { cache: { save(s: string): void } }) => {
          cache.save(SECRET_CACHE);
          return { identity: msIdentity('oid-admin-2'), tokenCache: undefined, scopes: ['Files.ReadWrite'] };
        },
      );
      expect(await flow(service.completeConnect(session(NEW_ADMIN, 'oid-admin-2'), 'c2', TX))).toMatchObject({
        flow: 'account_mismatch',
        reason: 'central_account_differs',
      });

      expect(connection.rows).toHaveLength(1);
      expect(JSON.stringify(connection.rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(before);
    });

    it('the token exchange fails', async () => {
      const { service, session, identity, connection } = setup();
      identity.redeemAuthorizationCode.mockRejectedValueOnce(new AuthFlowError('login_failed', 'code_rejected'));
      expect(await flow(service.completeConnect(session(USER.admin, 'oid-admin'), 'c', TX))).toEqual({
        flow: 'login_failed',
        reason: 'code_rejected',
      });
      identity.redeemAuthorizationCode.mockRejectedValueOnce(new Error('network'));
      expect(await flow(service.completeConnect(session(USER.admin, 'oid-admin'), 'c', TX))).toEqual({
        flow: 'login_failed',
        reason: 'token_exchange_failed',
      });
      expect(connection.rows).toHaveLength(0);
    });

    it('the OneDrive folders cannot be created (reported as such, nothing stored)', async () => {
      const { service, session, storage, connection } = setup();
      storage.ensureLayout.mockRejectedValueOnce(new MicrosoftApiError('consent_required'));
      expect(await flow(service.completeConnect(session(USER.admin, 'oid-admin'), 'c', TX))).toMatchObject({
        flow: 'consent_required',
      });
      storage.ensureLayout.mockRejectedValueOnce(new MicrosoftApiError('reauth_required'));
      expect(await flow(service.completeConnect(session(USER.admin, 'oid-admin'), 'c', TX))).toMatchObject({
        flow: 'session_expired',
      });
      storage.ensureLayout.mockRejectedValueOnce(new MicrosoftApiError('unavailable'));
      expect(await flow(service.completeConnect(session(USER.admin, 'oid-admin'), 'c', TX))).toMatchObject({
        flow: 'central_storage_unavailable',
      });
      expect(connection.rows).toHaveLength(0);
    });

    it('the connection cannot be saved', async () => {
      const { service, session, connection } = setup();
      connection.create = jest.fn().mockRejectedValue(new Error('db down'));
      expect(await flow(service.completeConnect(session(USER.admin, 'oid-admin'), 'c', TX))).toEqual({
        flow: 'central_storage_unavailable',
        reason: 'connection_not_saved',
      });
      expect(connection.rows).toHaveLength(0);
    });
  });
});

describe('what the administrator page can see', () => {
  it('"not connected" before anything is set up', async () => {
    const { service } = setup();
    expect(await service.getStatus()).toMatchObject({
      status: 'not_connected',
      usable: false,
      account: null,
      quota: null,
    });
  });

  it('shows the connected account and health, and NEVER any token, ciphertext, nonce or OneDrive id', async () => {
    const { service, session } = setup();
    await service.completeConnect(session(USER.admin, 'oid-admin'), 'c', TX);
    const status = await service.getStatus();

    expect(status).toMatchObject({
      status: 'connected',
      usable: true,
      rootFolderPath: 'FileForge-Central',
      account: { displayName: 'Admin', email: 'admin@example.com', accountType: 'personal' },
    });
    const text = JSON.stringify(status);
    for (const forbidden of [
      'REFRESH-TOKEN',
      'ciphertext',
      'nonce',
      'auth_tag',
      'oid-admin',
      'drive-1',
      'root-1',
      'users-1',
      'home-oid',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('a lost authorization is visible as "reauth_required" with its reason', async () => {
    const { service, session, connection } = setup();
    await service.completeConnect(session(USER.admin, 'oid-admin'), 'c', TX);
    Object.assign(connection.rows[0] as object, {
      connection_status: 'reauth_required',
      last_error_code: 'reauth_required',
      last_error_at: new Date(),
    });
    expect(await service.getStatus()).toMatchObject({
      status: 'reauth_required',
      usable: false,
      lastErrorCode: 'reauth_required',
    });
  });
});

describe('health check (verify)', () => {
  it('records the quota and the time of the check', async () => {
    const { service, session, connection, storage, adminActor } = setup();
    await service.completeConnect(session(USER.admin, 'oid-admin'), 'c', TX);
    storage.health.mockResolvedValue({ total: 5_000_000, used: 1_000_000, remaining: 4_000_000, state: 'normal' });

    const status = await service.verify(await adminActor());

    expect(status.quota).toEqual({ total: 5_000_000, used: 1_000_000, remaining: 4_000_000, state: 'normal' });
    expect(status.lastVerifiedAt).not.toBeNull();
    expect((connection.rows[0] as Record<string, unknown>)['last_error_code']).toBeNull();
  });

  it('remembers why a check failed, without changing a working connection’s status', async () => {
    const { service, session, connection, storage, adminActor } = setup();
    await service.completeConnect(session(USER.admin, 'oid-admin'), 'c', TX);
    storage.health.mockRejectedValue(new HttpException({ code: 'CENTRAL_STORAGE_UNAVAILABLE', message: 'x' }, 503));
    const status = await service.verify(await adminActor());
    expect(status).toMatchObject({ status: 'connected', lastErrorCode: 'CENTRAL_STORAGE_UNAVAILABLE' });
    expect(connection.rows).toHaveLength(1);
  });

  it('only administrators can run it', async () => {
    const { service, storage } = setup();
    expect(await flow(service.verify({ userId: USER.alice, isAdmin: true }))).toMatchObject({ status: 403 });
    expect(storage.health).not.toHaveBeenCalled();
  });
});
