import { Logger } from '@nestjs/common';

import { AuthFlowError } from '../../../common/exceptions/auth-flow.error';
import type { OAuthTransaction, SessionUser } from '../../../common/types/session.types';
import authConfig from '../../../config/auth.config';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { GraphClient } from '../../microsoft/graph/graph.client';
import type { MicrosoftIdentityService } from '../../microsoft/identity/microsoft-identity.service';
import { OAuthTransactionStore } from '../../microsoft/identity/oauth-transaction.store';
import { MicrosoftApiError } from '../../microsoft/microsoft.errors';
import type { WorkspacesService } from '../../workspaces/workspaces.service';
import { OneDriveConnectionService, type StorageSession } from './onedrive-connection.service';
import { CONNECT_SCOPES, MODULE_FOLDERS } from './onedrive.constants';

const USER: SessionUser = { id: '7', email: 'owner@example.com', displayName: null };
const ISSUER = 'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0';
const TX: OAuthTransaction = {
  codeVerifier: 'v',
  nonce: 'n',
  createdAt: Date.now(),
  purpose: 'connect_onedrive',
  workspaceId: '1',
};

const connectionRow = (over: Record<string, unknown> = {}) => ({
  id: 5n,
  name: 'OneDrive',
  external_drive_id: 'drive-1',
  root_folder_item_id: 'root-1',
  root_folder_path: 'FileForge',
  connection_status: 'connected',
  last_auth_at: new Date('2026-11-04T10:00:00Z'),
  last_verified_at: null,
  secret_reference: null,
  ...over,
});

function setup(sessionOver: Partial<StorageSession> = {}) {
  const prisma = {
    connections: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 5n }),
      update: jest.fn().mockResolvedValue({}),
    },
    storage_provider_types: { findFirst: jest.fn().mockResolvedValue({ id: 3n, code: 'onedrive' }) },
    folder_mappings: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((work: (tx: typeof prisma) => unknown) => work(prisma));

  const identity = {
    createAuthorizationRequest: jest.fn().mockResolvedValue({
      url: 'https://login.microsoftonline.com/authorize?x=1',
      state: 'S'.repeat(43),
      nonce: 'nonce-1',
      codeVerifier: 'verifier-1',
    }),
    acquireTokenSilent: jest.fn().mockResolvedValue({ accessToken: 'tok', expiresOn: null }),
    redeemAuthorizationCode: jest.fn().mockImplementation(({ cache }: { cache: { save: (s: string) => void } }) => {
      cache.save('NEW-MSAL-CACHE-WITH-REFRESH-TOKEN');
      return Promise.resolve({
        identity: { issuer: ISSUER, subject: 'oid-1', homeAccountId: 'home-1' },
        tokenCache: undefined,
        scopes: ['Files.ReadWrite', 'User.Read'],
      });
    }),
  };

  const graph = { request: jest.fn() };
  const folders = new Map<string, object>();
  graph.request.mockImplementation((_ctx: unknown, path: string, options?: { method?: string; body?: string }) => {
    const known = folders.get(path);
    if (options?.method === 'POST') {
      const created = {
        id: `created-${JSON.parse(options.body ?? '{}').name}`,
        folder: {},
        parentReference: { driveId: 'drive-1' },
      };
      return Promise.resolve(created);
    }
    if (path === '/me/drive') return Promise.resolve({ id: 'drive-1' });
    if (known) return Promise.resolve(known);
    // Every folder lookup succeeds with an id derived from its path, unless a test overrides it.
    return Promise.resolve({
      id: `id:${decodeURIComponent(path.split(':/')[1] ?? path)}`,
      folder: {},
      parentReference: { driveId: 'drive-1' },
    });
  });

  const workspaces = { findActiveMembership: jest.fn().mockResolvedValue({ workspaceId: '1', roleCode: 'owner' }) };
  const transactions = new OAuthTransactionStore(authConfig());
  const service = new OneDriveConnectionService(
    prisma as unknown as PrismaService,
    identity as unknown as MicrosoftIdentityService,
    graph as unknown as GraphClient,
    transactions,
    workspaces as unknown as WorkspacesService,
  );
  const session: StorageSession = {
    user: USER,
    identity: { issuer: ISSUER, subject: 'oid-1' },
    homeAccountId: 'home-1',
    msalCache: 'OLD-CACHE',
    cookie: {},
    ...sessionOver,
  };
  return { service, prisma, identity, graph, workspaces, transactions, session, folders };
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    const e = error as { response?: { code?: string }; getStatus?: () => number };
    return { code: e.response?.code, status: e.getStatus?.() };
  }
  return undefined;
};

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe('requireUsable', () => {
  it('returns the stored drive and root, looked up by workspace, owner and provider only', async () => {
    const { service, prisma } = setup();
    prisma.connections.findFirst.mockResolvedValue(connectionRow());

    await expect(service.requireUsable('1', USER)).resolves.toEqual({
      id: 5n,
      workspaceId: 1n,
      driveId: 'drive-1',
      rootItemId: 'root-1',
    });

    expect(prisma.connections.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspace_id: 1n,
          owner_user_id: 7n,
          is_deleted: false,
          is_active: true,
          storage_provider_types: { code: 'onedrive' },
        },
      }),
    );
  });

  it('refuses a workspace whose OneDrive belongs to another member (403), and says so only when one exists', async () => {
    const { service, prisma } = setup();
    prisma.connections.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 9n });
    expect(await codeOf(service.requireUsable('1', USER))).toEqual({
      code: 'ONEDRIVE_CONNECTION_NOT_OWNED',
      status: 403,
    });

    prisma.connections.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    expect(await codeOf(service.requireUsable('1', USER))).toEqual({ code: 'ONEDRIVE_NOT_CONNECTED', status: 404 });
  });

  it('looks for other members’ connections only in the same workspace', async () => {
    const { service, prisma } = setup();
    await codeOf(service.requireUsable('1', USER));
    const otherLookup = prisma.connections.findFirst.mock.calls[1][0];
    expect(otherLookup.where).toMatchObject({
      workspace_id: 1n,
      OR: [{ owner_user_id: null }, { owner_user_id: { not: 7n } }],
    });
  });

  it.each([
    ['no drive id', { external_drive_id: null }],
    ['no root folder id', { root_folder_item_id: null }],
    ['a revoked connection', { connection_status: 'revoked' }],
    ['an errored connection', { connection_status: 'error' }],
  ])('refuses %s (409) instead of guessing', async (_label, over) => {
    const { service, prisma } = setup();
    prisma.connections.findFirst.mockResolvedValue(connectionRow(over));
    expect(await codeOf(service.requireUsable('1', USER))).toEqual({
      code: 'ONEDRIVE_CONNECTION_INVALID',
      status: 409,
    });
  });
});

describe('getStatus', () => {
  it('is not_connected when the workspace has no OneDrive at all', async () => {
    const { service, session } = setup();
    expect(await service.getStatus('1', USER, session)).toEqual({ status: 'not_connected', connection: null });
  });

  it('is owned_by_other_user when only someone else has connected one', async () => {
    const { service, prisma, session } = setup();
    prisma.connections.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 9n });
    expect(await service.getStatus('1', USER, session)).toEqual({ status: 'owned_by_other_user', connection: null });
  });

  it('is connected when the stored tokens can produce a Files.ReadWrite token, and never exposes secrets', async () => {
    const { service, prisma, identity, session } = setup();
    prisma.connections.findFirst.mockResolvedValue(connectionRow({ secret_reference: 'vault://x' }));

    const status = await service.getStatus('1', USER, session);

    expect(status).toEqual({
      status: 'connected',
      connection: {
        id: '5',
        name: 'OneDrive',
        rootFolderPath: 'FileForge',
        lastAuthAt: '2026-11-04T10:00:00.000Z',
        lastVerifiedAt: null,
      },
    });
    expect(JSON.stringify(status)).not.toMatch(/drive-1|root-1|vault|secret/);
    expect(identity.acquireTokenSilent).toHaveBeenCalledWith(
      expect.objectContaining({ homeAccountId: 'home-1', scopes: ['Files.ReadWrite'] }),
    );
  });

  it.each([
    ['consent_required', 'consent_required'],
    ['reauth_required', 'reauth_required'],
    ['unavailable', 'error'],
  ] as const)('maps a %s token result to the status "%s"', async (kind, expected) => {
    const { service, prisma, identity, session } = setup();
    prisma.connections.findFirst.mockResolvedValue(connectionRow());
    identity.acquireTokenSilent.mockRejectedValue(new MicrosoftApiError(kind));
    expect((await service.getStatus('1', USER, session)).status).toBe(expected);
  });

  it('asks for re-authentication when the session holds no Microsoft account (e.g. after a restart)', async () => {
    const { service, prisma, identity, session } = setup({ homeAccountId: undefined });
    prisma.connections.findFirst.mockResolvedValue(connectionRow());
    expect((await service.getStatus('1', USER, session)).status).toBe('reauth_required');
    expect(identity.acquireTokenSilent).not.toHaveBeenCalled();
  });

  it('reports a connection without drive/root ids as an error', async () => {
    const { service, prisma, session } = setup();
    prisma.connections.findFirst.mockResolvedValue(connectionRow({ external_drive_id: null }));
    expect((await service.getStatus('1', USER, session)).status).toBe('error');
  });

  it('does not swallow unexpected failures as a status', async () => {
    const { service, prisma, identity, session } = setup();
    prisma.connections.findFirst.mockResolvedValue(connectionRow());
    identity.acquireTokenSilent.mockRejectedValue(new Error('boom'));
    await expect(service.getStatus('1', USER, session)).rejects.toThrow('boom');
  });
});

describe('startConnect', () => {
  it('asks only for the Files.ReadWrite consent, as the signed-in account, and remembers what it is for', async () => {
    const { service, identity, transactions, session } = setup();

    const url = await service.startConnect('1', USER, session);

    expect(url).toBe('https://login.microsoftonline.com/authorize?x=1');
    expect(identity.createAuthorizationRequest).toHaveBeenCalledWith({
      scopes: CONNECT_SCOPES,
      loginHint: 'owner@example.com',
    });
    expect(CONNECT_SCOPES).toContain('Files.ReadWrite');
    expect(CONNECT_SCOPES.join(' ')).not.toMatch(/Mail|Sites|Directory/);

    // The purpose and workspace are recorded server-side (single use); the browser cannot choose them.
    const pending = transactions.take(session, 'S'.repeat(43));
    expect(pending).toMatchObject({
      purpose: 'connect_onedrive',
      workspaceId: '1',
      codeVerifier: 'verifier-1',
      nonce: 'nonce-1',
    });
    expect(transactions.take(session, 'S'.repeat(43))).toBeUndefined();
  });

  it.each([
    ['no signed-in identity', { identity: undefined }],
    ['no Microsoft account', { homeAccountId: undefined }],
  ])('asks the user to sign in again when the session has %s', async (_label, over) => {
    const { service, identity, session } = setup(over);
    expect(await codeOf(service.startConnect('1', USER, session))).toEqual({
      code: 'MICROSOFT_REAUTH_REQUIRED',
      status: 401,
    });
    expect(identity.createAuthorizationRequest).not.toHaveBeenCalled();
  });
});

describe('completeConnect', () => {
  const run = (env: ReturnType<typeof setup>, tx: OAuthTransaction = TX) =>
    env.service.completeConnect(env.session, 'auth-code', tx);
  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error as AuthFlowError;
    }
    throw new Error('expected a failure');
  };

  describe('authorization is re-checked after the Microsoft detour', () => {
    it.each([
      ['a signed-out session', { user: undefined }],
      ['a session without a signed-in identity', { identity: undefined }],
    ])('refuses %s', async (_label, over) => {
      const env = setup(over);
      const error = await failure(run(env));
      expect(error).toMatchObject({ code: 'session_expired' });
      expect(env.identity.redeemAuthorizationCode).not.toHaveBeenCalled();
    });

    it('refuses a transaction that names no workspace', async () => {
      const env = setup();
      expect(await failure(run(env, { ...TX, workspaceId: undefined }))).toMatchObject({ code: 'session_expired' });
    });

    it.each([['viewer'], ['editor']])('refuses a %s: only owners and admins may connect storage', async (roleCode) => {
      const env = setup();
      env.workspaces.findActiveMembership.mockResolvedValue({ workspaceId: '1', roleCode });
      expect(await failure(run(env))).toMatchObject({ code: 'workspace_forbidden' });
      expect(env.identity.redeemAuthorizationCode).not.toHaveBeenCalled(); // the code is not even exchanged
    });

    it('refuses someone who is no longer a member', async () => {
      const env = setup();
      env.workspaces.findActiveMembership.mockResolvedValue(null);
      expect(await failure(run(env))).toMatchObject({ code: 'workspace_forbidden' });
      expect(env.graph.request).not.toHaveBeenCalled();
    });
  });

  describe('the consenting Microsoft account must be the signed-in one', () => {
    it.each([
      ['a different account (subject)', { issuer: ISSUER, subject: 'someone-else' }],
      [
        'a different tenant (issuer), same subject',
        { issuer: 'https://login.microsoftonline.com/other-tenant/v2.0', subject: 'oid-1' },
      ],
    ])('rejects %s and discards the tokens it obtained', async (_label, other) => {
      const env = setup();
      env.identity.redeemAuthorizationCode.mockImplementation(({ cache }: { cache: { save: (s: string) => void } }) => {
        cache.save('OTHER-ACCOUNTS-CACHE');
        return Promise.resolve({
          identity: { ...other, homeAccountId: 'home-x' },
          tokenCache: undefined,
          scopes: ['Files.ReadWrite'],
        });
      });

      expect(await failure(run(env))).toMatchObject({ code: 'account_mismatch' });

      expect(env.session.msalCache).toBe('OLD-CACHE'); // the other account's tokens never reached the session
      expect(env.session.homeAccountId).toBe('home-1');
      expect(env.graph.request).not.toHaveBeenCalled();
      expect(env.prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('on success', () => {
    it('merges the new tokens into the session cache only after the account is verified', async () => {
      const env = setup();
      await run(env);
      expect(env.session.msalCache).toBe('NEW-MSAL-CACHE-WITH-REFRESH-TOKEN');
      expect(env.identity.redeemAuthorizationCode).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'auth-code', codeVerifier: 'v', nonce: 'n', scopes: CONNECT_SCOPES }),
      );
    });

    it('stores a delegated connection with the drive, root and consented scopes, and NO token or secret', async () => {
      const env = setup();
      await run(env);

      const { data } = env.prisma.connections.create.mock.calls[0][0];
      expect(data).toMatchObject({
        workspace_id: 1n,
        provider_type_id: 3n,
        owner_user_id: 7n,
        auth_mode: 'delegated',
        connection_status: 'connected',
        external_drive_id: 'drive-1',
        root_folder_item_id: 'id:FileForge',
        root_folder_path: 'FileForge',
        consented_scopes: ['Files.ReadWrite', 'User.Read'],
        is_default: true,
        created_by: 7n,
      });
      expect(data).not.toHaveProperty('secret_reference');
      const everythingWritten = JSON.stringify(
        [env.prisma.connections.create, env.prisma.connections.update, env.prisma.folder_mappings.create].map(
          (m) => m.mock.calls,
        ),
        (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
      );
      expect(everythingWritten).not.toMatch(/NEW-MSAL-CACHE|REFRESH|refresh_token|access_token|OLD-CACHE|verifier/);
    });

    it('registers every module folder under its module code, relative to the FileForge root', async () => {
      const env = setup();
      await run(env);

      const created = env.prisma.folder_mappings.create.mock.calls.map((c) => c[0].data);
      expect(created).toHaveLength(MODULE_FOLDERS.length);
      for (const { folderName, moduleCode } of MODULE_FOLDERS) {
        expect(created).toContainEqual(
          expect.objectContaining({
            workspace_id: 1n,
            connection_id: 5n,
            module_code: moduleCode,
            folder_name: folderName,
            relative_path: folderName,
            external_folder_item_id: `id:${folderName}`,
          }),
        );
      }
      expect(MODULE_FOLDERS.map((m) => m.folderName)).toEqual([
        'business-cards',
        'email-attachments',
        'exports',
        'invoices',
        'pdf-documents',
        'qr-scans',
        'receipts',
        'reports',
      ]);
    });

    it('is idempotent: connecting again updates the same connection and mappings instead of adding more', async () => {
      const env = setup();
      env.prisma.connections.findFirst.mockResolvedValue({ id: 5n });
      env.prisma.folder_mappings.findFirst.mockResolvedValue({ id: 11n });

      await run(env);

      expect(env.prisma.connections.create).not.toHaveBeenCalled();
      expect(env.prisma.connections.update).toHaveBeenCalledWith({
        where: { id: 5n },
        data: expect.objectContaining({ connection_status: 'connected', external_drive_id: 'drive-1' }),
      });
      expect(env.prisma.folder_mappings.create).not.toHaveBeenCalled();
      expect(env.prisma.folder_mappings.update).toHaveBeenCalledTimes(MODULE_FOLDERS.length);
    });

    it('does not take the default slot when the workspace already has a default connection', async () => {
      const env = setup();
      env.prisma.connections.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 99n });
      await run(env);
      expect(env.prisma.connections.create.mock.calls[0][0].data.is_default).toBe(false);
    });

    it('creates the FileForge folder and any missing module folder, and nothing else', async () => {
      const env = setup();
      env.graph.request.mockImplementation(
        (_c: unknown, path: string, options?: { method?: string; body?: string }) => {
          if (path === '/me/drive') return Promise.resolve({ id: 'drive-1' });
          if (options?.method === 'POST') {
            const body = JSON.parse(options.body ?? '{}');
            return Promise.resolve({ id: `new-${body.name}`, folder: {}, parentReference: { driveId: 'drive-1' } });
          }
          return Promise.reject(new MicrosoftApiError('not_found')); // nothing exists yet
        },
      );

      await run(env);

      const posts = env.graph.request.mock.calls.filter((c) => c[2]?.method === 'POST');
      expect(posts.map((c) => JSON.parse(c[2].body).name)).toEqual([
        'FileForge',
        ...MODULE_FOLDERS.map((m) => m.folderName),
      ]);
      for (const [, , options] of posts) {
        expect(JSON.parse(options.body)).toMatchObject({ folder: {}, '@microsoft.graph.conflictBehavior': 'fail' });
      }
      const deletes = env.graph.request.mock.calls.filter((c) => ['DELETE', 'PATCH', 'PUT'].includes(c[2]?.method));
      expect(deletes).toHaveLength(0); // never modifies or removes anything that exists
      expect(env.prisma.connections.create.mock.calls[0][0].data.root_folder_item_id).toBe('new-FileForge');
    });

    it('reads a folder that someone else created a moment ago instead of failing', async () => {
      const env = setup();
      let rootReads = 0;
      env.graph.request.mockImplementation(
        (_c: unknown, path: string, options?: { method?: string; body?: string }) => {
          if (path === '/me/drive') return Promise.resolve({ id: 'drive-1' });
          if (options?.method === 'POST') return Promise.reject(new MicrosoftApiError('conflict'));
          if (path.endsWith('root:/FileForge') && rootReads++ === 0)
            return Promise.reject(new MicrosoftApiError('not_found'));
          return Promise.resolve({ id: `id:${path}`, folder: {}, parentReference: { driveId: 'drive-1' } });
        },
      );
      await expect(run(env)).resolves.toBeUndefined();
    });

    it('never adopts a FILE named FileForge as the root', async () => {
      const env = setup();
      env.graph.request.mockImplementation((_c: unknown, path: string) =>
        path === '/me/drive'
          ? Promise.resolve({ id: 'drive-1' })
          : Promise.resolve({ id: 'x', parentReference: { driveId: 'drive-1' } }),
      );
      expect(await failure(run(env))).toMatchObject({ code: 'onedrive_unavailable' });
      expect(env.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('never adopts a folder from another drive', async () => {
      const env = setup();
      env.graph.request.mockImplementation((_c: unknown, path: string) =>
        path === '/me/drive'
          ? Promise.resolve({ id: 'drive-1' })
          : Promise.resolve({ id: 'x', folder: {}, parentReference: { driveId: 'someone-elses-drive' } }),
      );
      expect(await failure(run(env))).toMatchObject({ code: 'onedrive_unavailable' });
    });
  });

  describe('failures', () => {
    it.each([
      ['consent_required', 'consent_required'],
      ['reauth_required', 'session_expired'],
      ['unavailable', 'onedrive_unavailable'],
      ['unknown', 'onedrive_unavailable'],
    ] as const)('maps a Graph %s failure to the safe code "%s"', async (kind, expected) => {
      const env = setup();
      env.graph.request.mockRejectedValue(new MicrosoftApiError(kind));
      expect(await failure(run(env))).toMatchObject({ code: expected });
      expect(env.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('reports a failed code exchange without touching Graph or the database', async () => {
      const env = setup();
      env.identity.redeemAuthorizationCode.mockRejectedValue(new AuthFlowError('login_failed', 'code_rejected'));
      expect(await failure(run(env))).toMatchObject({ code: 'login_failed', reason: 'code_rejected' });
      expect(env.graph.request).not.toHaveBeenCalled();
      expect(env.session.msalCache).toBe('OLD-CACHE');
    });

    it.each([
      [
        'the OneDrive provider type is not seeded',
        (env: ReturnType<typeof setup>) => env.prisma.storage_provider_types.findFirst.mockResolvedValue(null),
      ],
      [
        'the database fails',
        (env: ReturnType<typeof setup>) => env.prisma.$transaction.mockRejectedValue(new Error('db down')),
      ],
    ])('fails closed when %s', async (_label, arrange) => {
      const env = setup();
      arrange(env);
      expect(await failure(run(env))).toMatchObject({ code: 'service_unavailable', reason: 'connection_not_saved' });
    });
  });
});
