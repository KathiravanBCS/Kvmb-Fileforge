import { Readable } from 'node:stream';

import request from 'supertest';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../../app.module';
import { configureApp } from '../../../app.setup';
import { AuthFlowError } from '../../../common/exceptions/auth-flow.error';
import { randomToken } from '../../../common/utils/security.util';
import { TEST_ENV } from '../../../testing/test-env';
import { MicrosoftIdentityService } from '../../microsoft/identity/microsoft-identity.service';
import { OAuthTransactionStore } from '../../microsoft/identity/oauth-transaction.store';
import { UserProvisioningService } from '../../users/user-provisioning.service';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import { OneDriveConnectionService } from './onedrive-connection.service';
import { OneDriveFilesService } from './onedrive-files.service';
import { MAX_UPLOAD_BYTES } from './onedrive.constants';

const FRONTEND = TEST_ENV.FRONTEND_URL;
const BASE = '/api/v1';
const CONNECT_STATE = 'C'.repeat(43);

const identityService = { createAuthorizationRequest: jest.fn(), redeemAuthorizationCode: jest.fn() };
const provisioning = { resolveOrProvision: jest.fn() };
const memberships = new Map<string, string>(); // "userId:workspaceId" -> role code
const workspacesFake = {
  findActiveMembership: jest.fn((userId: string, workspaceId: string) => {
    const role = memberships.get(`${userId}:${workspaceId}`);
    return Promise.resolve(role ? { workspaceId, roleCode: role } : null);
  }),
  listForUser: jest.fn(),
};
const item = { name: 'a.txt', type: 'file', size: 1, mimeType: null, modifiedAt: null, path: 'a.txt' };
const filesFake = {
  list: jest.fn(),
  upload: jest.fn(),
  download: jest.fn(),
  rename: jest.fn(),
  delete: jest.fn(),
};
const connectionFake = { getStatus: jest.fn(), startConnect: jest.fn(), completeConnect: jest.fn() };

let app: NestExpressApplication;

beforeEach(async () => {
  memberships.clear();
  identityService.createAuthorizationRequest.mockImplementation(() => {
    const state = randomToken();
    return Promise.resolve({
      url: `https://login.microsoftonline.com/authorize?state=${state}`,
      state,
      nonce: `n-${state}`,
      codeVerifier: `v-${state}`,
    });
  });
  identityService.redeemAuthorizationCode.mockResolvedValue({
    identity: {
      provider: 'microsoft',
      issuer: 'iss',
      subject: 'oid-1',
      homeAccountId: 'home-1',
      accountType: 'personal',
    },
    tokenCache: 'CACHE',
    scopes: [],
  });
  filesFake.list.mockResolvedValue({ path: '', items: [], truncated: false });
  filesFake.upload.mockResolvedValue(item);
  filesFake.download.mockResolvedValue({
    stream: Readable.from([Buffer.from('FILE-BYTES')]),
    filename: 'résumé "x".pdf',
  });
  filesFake.rename.mockResolvedValue(item);
  filesFake.delete.mockResolvedValue(undefined);
  connectionFake.getStatus.mockResolvedValue({ status: 'connected', connection: null });
  connectionFake.completeConnect.mockResolvedValue(undefined);
  connectionFake.startConnect.mockImplementation((workspaceId: string, _user: unknown, session: never) => {
    app.get(OAuthTransactionStore).add(session, CONNECT_STATE, {
      codeVerifier: 'cv',
      nonce: 'cn',
      purpose: 'connect_onedrive',
      workspaceId,
    });
    return Promise.resolve('https://login.microsoftonline.com/connect');
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MicrosoftIdentityService)
    .useValue(identityService)
    .overrideProvider(UserProvisioningService)
    .useValue(provisioning)
    .overrideProvider(WorkspacesService)
    .useValue(workspacesFake)
    .overrideProvider(OneDriveFilesService)
    .useValue(filesFake)
    .overrideProvider(OneDriveConnectionService)
    .useValue(connectionFake)
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
});

afterEach(async () => {
  jest.clearAllMocks();
  await app.close();
});

type Agent = ReturnType<typeof request.agent>;

async function signInAs(userId: string): Promise<{ agent: Agent; csrf: string }> {
  provisioning.resolveOrProvision.mockResolvedValue({
    id: BigInt(userId),
    email: `u${userId}@example.com`,
    displayName: null,
  });
  const agent = request.agent(app.getHttpServer());
  const login = await agent.get(`${BASE}/auth/microsoft/login`).expect(302);
  const state = new URL(login.headers['location']).searchParams.get('state');
  await agent.get(`${BASE}/auth/microsoft/callback?code=c&state=${state}`).expect(302);
  const csrf = (await agent.get(`${BASE}/auth/csrf`).expect(200)).body.csrfToken as string;
  return { agent, csrf };
}

const root = (workspace: string) => `${BASE}/workspaces/${workspace}/storage/onedrive`;

interface Operation {
  name: string;
  service: jest.Mock;
  okStatus: number;
  allowed: string[];
  mutates: boolean;
  send: (agent: Agent, workspace: string, csrf?: string) => request.Test;
}
const withCsrf = (test: request.Test, csrf?: string) =>
  csrf ? test.set('Origin', FRONTEND).set('X-CSRF-Token', csrf) : test;

const OPERATIONS: Operation[] = [
  {
    name: 'status',
    service: connectionFake.getStatus,
    okStatus: 200,
    mutates: false,
    allowed: ['owner', 'admin', 'editor', 'viewer'],
    send: (a, w) => a.get(root(w)),
  },
  {
    name: 'connect',
    service: connectionFake.startConnect,
    okStatus: 200,
    mutates: true,
    allowed: ['owner', 'admin'],
    send: (a, w, c) => withCsrf(a.post(`${root(w)}/connect`), c),
  },
  {
    name: 'list',
    service: filesFake.list,
    okStatus: 200,
    mutates: false,
    allowed: ['owner', 'admin', 'editor', 'viewer'],
    send: (a, w) => a.get(`${root(w)}/items?path=invoices`),
  },
  {
    name: 'download',
    service: filesFake.download,
    okStatus: 200,
    mutates: false,
    allowed: ['owner', 'admin', 'editor', 'viewer'],
    send: (a, w) => a.get(`${root(w)}/files/content?path=invoices/a.pdf`),
  },
  {
    name: 'upload',
    service: filesFake.upload,
    okStatus: 201,
    mutates: true,
    allowed: ['owner', 'admin', 'editor'],
    send: (a, w, c) =>
      withCsrf(a.post(`${root(w)}/files`), c)
        .field('path', 'invoices')
        .attach('file', Buffer.from('x'), 'a.txt'),
  },
  {
    name: 'rename',
    service: filesFake.rename,
    okStatus: 200,
    mutates: true,
    allowed: ['owner', 'admin', 'editor'],
    send: (a, w, c) => withCsrf(a.patch(`${root(w)}/files`), c).send({ path: 'a.txt', newName: 'b.txt' }),
  },
  {
    name: 'delete',
    service: filesFake.delete,
    okStatus: 204,
    mutates: true,
    allowed: ['owner', 'admin'],
    send: (a, w, c) => withCsrf(a.delete(`${root(w)}/files?path=a.txt`), c),
  },
];
const ROLES = ['owner', 'admin', 'editor', 'viewer'];

describe('authentication', () => {
  it.each(OPERATIONS)('$name requires a signed-in session', async (op) => {
    const res = await op.send(request.agent(app.getHttpServer()), '1', 'any-token');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(op.service).not.toHaveBeenCalled();
  });
});

describe('role-based access (workspace-scoped, by role code)', () => {
  for (const role of ROLES) {
    describe(`as ${role}`, () => {
      it.each(OPERATIONS)('$name', async (op) => {
        memberships.set('7:1', role);
        const { agent, csrf } = await signInAs('7');
        const res = await op.send(agent, '1', csrf);

        if (op.allowed.includes(role)) {
          expect(res.status).toBe(op.okStatus);
          expect(op.service).toHaveBeenCalledTimes(1);
        } else {
          expect(res.status).toBe(403);
          expect(res.body.error.code).toBe('WORKSPACE_ROLE_FORBIDDEN');
          expect(op.service).not.toHaveBeenCalled();
        }
      });
    });
  }
});

describe('workspace isolation', () => {
  it.each(OPERATIONS)('$name: a member of workspace 1 cannot reach workspace 2', async (op) => {
    memberships.set('7:1', 'owner'); // owner of 1, no relationship at all with 2
    const { agent, csrf } = await signInAs('7');

    const res = await op.send(agent, '2', csrf);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('WORKSPACE_ACCESS_DENIED');
    expect(op.service).not.toHaveBeenCalled();
  });

  it('answers the same way for a workspace that does not exist (no existence oracle)', async () => {
    memberships.set('7:1', 'owner');
    const { agent } = await signInAs('7');
    const missing = await agent.get(root('999999')).expect(403);
    const foreign = await agent.get(root('2')).expect(403);
    expect(missing.body.error).toMatchObject({ code: foreign.body.error.code, message: foreign.body.error.message });
  });

  it.each([['abc'], ['1.5'], ['-1'], ['9223372036854775808'], ['1%20OR%201=1']])(
    'rejects the workspace id "%s" (400)',
    async (id) => {
      memberships.set('7:1', 'owner');
      const { agent } = await signInAs('7');
      const res = await agent.get(root(id));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_WORKSPACE_ID');
      expect(connectionFake.getStatus).not.toHaveBeenCalled();
    },
  );

  it('gives each user only their own workspace, resolved from the URL after the membership check', async () => {
    memberships.set('7:1', 'owner');
    memberships.set('8:2', 'owner');
    const one = await signInAs('7');
    const two = await signInAs('8');

    await one.agent.get(`${root('1')}/items`).expect(200);
    await two.agent.get(`${root('2')}/items`).expect(200);
    await two.agent.get(`${root('1')}/items`).expect(403);
    await one.agent.get(`${root('2')}/items`).expect(403);

    expect(filesFake.list).toHaveBeenCalledTimes(2);
    expect(filesFake.list.mock.calls[0][0]).toMatchObject({ workspaceId: '1', user: { id: '7' } });
    expect(filesFake.list.mock.calls[1][0]).toMatchObject({ workspaceId: '2', user: { id: '8' } });
  });

  it('ignores a workspace id smuggled in the body or query: the URL, after the membership check, decides', async () => {
    memberships.set('7:1', 'owner');
    const { agent, csrf } = await signInAs('7');

    await withCsrf(agent.patch(`${root('1')}/files?workspaceId=2`), csrf)
      .send({ path: 'a.txt', newName: 'b.txt', workspaceId: '2' })
      .expect(200);

    expect(filesFake.rename.mock.calls[0][0]).toMatchObject({ workspaceId: '1' });
  });

  it('removes access immediately when the membership is gone', async () => {
    memberships.set('7:1', 'editor');
    const { agent } = await signInAs('7');
    await agent.get(`${root('1')}/items`).expect(200);
    memberships.delete('7:1');
    await agent.get(`${root('1')}/items`).expect(403);
  });

  it('rejects a non-member’s upload at the guard, before the file is processed or the service is reached', async () => {
    memberships.set('7:1', 'owner');
    const { agent, csrf } = await signInAs('7');
    const res = await withCsrf(agent.post(`${root('2')}/files`), csrf).attach('file', Buffer.alloc(64 * 1024), 'a.bin');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('WORKSPACE_ACCESS_DENIED');
    expect(filesFake.upload).not.toHaveBeenCalled();
  });

  it('does not even accept the bytes of an oversized upload from a non-member: the server closes early', async () => {
    memberships.set('7:1', 'owner');
    const { agent, csrf } = await signInAs('7');
    const outcome = await withCsrf(agent.post(`${root('2')}/files`), csrf)
      .attach('file', Buffer.alloc(MAX_UPLOAD_BYTES * 2), 'big.bin')
      .then(
        (res) => res.status,
        (error: { code?: string; status?: number }) => error.status ?? error.code,
      );
    // Either a clean 403 or the connection reset that an early rejection causes while the client is still sending.
    expect([403, 'ECONNRESET', 'EPIPE']).toContain(outcome);
    expect(filesFake.upload).not.toHaveBeenCalled();
  });
});

describe('CSRF protection on state-changing routes', () => {
  const mutating = OPERATIONS.filter((op) => op.mutates);

  it.each(mutating)('$name is refused without a CSRF token even for an authorized owner', async (op) => {
    memberships.set('7:1', 'owner');
    const { agent } = await signInAs('7');
    const res = await op.send(agent, '1', undefined);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
    expect(op.service).not.toHaveBeenCalled();
  });

  it.each(mutating)('$name is refused with another session’s token', async (op) => {
    memberships.set('7:1', 'owner');
    memberships.set('8:1', 'owner');
    const { agent } = await signInAs('7');
    const other = await signInAs('8');
    const res = await op.send(agent, '1', other.csrf);
    expect(res.status).toBe(403);
    expect(op.service).not.toHaveBeenCalled();
  });

  it('is refused from a foreign origin even with a valid token', async () => {
    memberships.set('7:1', 'owner');
    const { agent, csrf } = await signInAs('7');
    const res = await agent
      .delete(`${root('1')}/files?path=a.txt`)
      .set('Origin', 'http://evil.example')
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ORIGIN_MISMATCH');
    expect(filesFake.delete).not.toHaveBeenCalled();
  });

  it('does not apply to reads (listing and downloading are safe GETs)', async () => {
    memberships.set('7:1', 'viewer');
    const { agent } = await signInAs('7');
    await agent.get(`${root('1')}/items`).expect(200);
    await agent.get(`${root('1')}/files/content?path=a.pdf`).expect(200);
  });
});

describe('uploads', () => {
  it('passes the target folder and the file (name and bytes) to the service', async () => {
    memberships.set('7:1', 'editor');
    const { agent, csrf } = await signInAs('7');
    const bytes = Buffer.from('%PDF-1.7 bytes');

    const res = await withCsrf(agent.post(`${root('1')}/files`), csrf)
      .field('path', 'invoices/2026')
      .attach('file', bytes, { filename: 'a.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(item);
    const [ctx, folder, file] = filesFake.upload.mock.calls[0];
    expect(ctx).toMatchObject({ workspaceId: '1', user: { id: '7' } });
    expect(folder).toBe('invoices/2026');
    expect(file.name).toBe('a.pdf');
    expect(Buffer.from(file.buffer).equals(bytes)).toBe(true);
  });

  it('keeps non-ASCII file names intact (UTF-8, not latin1)', async () => {
    memberships.set('7:1', 'editor');
    const { agent, csrf } = await signInAs('7');
    await withCsrf(agent.post(`${root('1')}/files`), csrf).attach('file', Buffer.from('x'), {
      filename: 'résumé€データ.pdf',
    });
    expect(filesFake.upload.mock.calls[0][2].name).toBe('résumé€データ.pdf');
  });

  it('accepts a file of exactly the size limit', async () => {
    memberships.set('7:1', 'editor');
    const { agent, csrf } = await signInAs('7');
    const res = await withCsrf(agent.post(`${root('1')}/files`), csrf).attach(
      'file',
      Buffer.alloc(MAX_UPLOAD_BYTES, 1),
      'edge.bin',
    );
    expect(res.status).toBe(201);
  });

  it('rejects a file over the limit with 413 while receiving it, and never calls the service', async () => {
    memberships.set('7:1', 'editor');
    const { agent, csrf } = await signInAs('7');
    const res = await withCsrf(agent.post(`${root('1')}/files`), csrf).attach(
      'file',
      Buffer.alloc(MAX_UPLOAD_BYTES + 1, 1),
      'big.bin',
    );
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(filesFake.upload).not.toHaveBeenCalled();
  });

  it('passes a missing file to the service as undefined (the service answers FILE_REQUIRED)', async () => {
    memberships.set('7:1', 'editor');
    const { agent, csrf } = await signInAs('7');
    await withCsrf(agent.post(`${root('1')}/files`), csrf).field('path', 'invoices');
    expect(filesFake.upload.mock.calls[0][2]).toBeUndefined();
  });

  it('does not accept more than one file or a second file field', async () => {
    memberships.set('7:1', 'editor');
    const { agent, csrf } = await signInAs('7');
    const res = await withCsrf(agent.post(`${root('1')}/files`), csrf)
      .attach('file', Buffer.from('1'), 'a.txt')
      .attach('file', Buffer.from('2'), 'b.txt');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(filesFake.upload).not.toHaveBeenCalled();
  });
});

describe('downloads', () => {
  it('streams the bytes as an attachment that can never be rendered inline', async () => {
    memberships.set('7:1', 'viewer');
    const { agent } = await signInAs('7');

    const res = await agent
      .get(`${root('1')}/files/content?path=invoices/a.pdf`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect((res.body as Buffer).toString()).toBe('FILE-BYTES');
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['content-disposition']).not.toMatch(/inline/i);
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9%20%22x%22.pdf");
    expect(filesFake.download.mock.calls[0][1]).toBe('invoices/a.pdf');
  });
});

describe('rename and delete input', () => {
  it.each([[{}], [{ path: 'a.txt' }], [{ newName: 'b.txt' }], [{ path: 5, newName: 'b' }], ['not json']])(
    'rename rejects the body %j with 400 INVALID_REQUEST',
    async (body) => {
      memberships.set('7:1', 'editor');
      const { agent, csrf } = await signInAs('7');
      const res = await withCsrf(agent.patch(`${root('1')}/files`), csrf).send(body as object);
      expect(res.status).toBe(400);
      expect(filesFake.rename).not.toHaveBeenCalled();
    },
  );

  it('passes the browser path to the service exactly as received (the service validates it)', async () => {
    memberships.set('7:1', 'admin');
    const { agent, csrf } = await signInAs('7');
    await withCsrf(agent.delete(`${root('1')}/files?path=..%2F..%2Fetc`), csrf).expect(204);
    expect(filesFake.delete.mock.calls[0][1]).toBe('../../etc');
  });
});

describe('GET /workspaces', () => {
  it('requires a session', async () => {
    await request(app.getHttpServer()).get(`${BASE}/workspaces`).expect(401);
    expect(workspacesFake.listForUser).not.toHaveBeenCalled();
  });

  it('returns only the signed-in user’s workspaces and roles', async () => {
    workspacesFake.listForUser.mockResolvedValue([{ id: '1', name: 'W', type: 'personal', role: 'owner' }]);
    const { agent } = await signInAs('7');
    const res = await agent.get(`${BASE}/workspaces`).expect(200);
    expect(res.body).toEqual([{ id: '1', name: 'W', type: 'personal', role: 'owner' }]);
    expect(workspacesFake.listForUser).toHaveBeenCalledWith('7');
  });
});

describe('Connect OneDrive: the shared Microsoft callback', () => {
  async function startConnect() {
    memberships.set('7:1', 'owner');
    const session = await signInAs('7');
    const started = await withCsrf(session.agent.post(`${root('1')}/connect`), session.csrf).expect(200);
    expect(started.body).toEqual({ url: 'https://login.microsoftonline.com/connect' });
    return session;
  }

  it('finishes the connection and returns the browser to the File Manager', async () => {
    const { agent } = await startConnect();
    const signIns = provisioning.resolveOrProvision.mock.calls.length;

    const res = await agent.get(`${BASE}/auth/microsoft/callback?code=auth-code&state=${CONNECT_STATE}`).expect(302);

    expect(res.headers['location']).toBe(`${FRONTEND}/files?onedrive=connected`);
    expect(connectionFake.completeConnect).toHaveBeenCalledWith(
      expect.anything(),
      'auth-code',
      expect.objectContaining({ purpose: 'connect_onedrive', workspaceId: '1', codeVerifier: 'cv', nonce: 'cn' }),
    );
    // It was NOT treated as a sign-in: no new user lookup, no new session.
    expect(provisioning.resolveOrProvision.mock.calls.length).toBe(signIns);
    await agent.get(`${BASE}/auth/me`).expect(200);
  });

  it.each([
    ['account_mismatch', 'account_mismatch'],
    ['workspace_forbidden', 'workspace_forbidden'],
    ['consent_required', 'consent_required'],
    ['onedrive_unavailable', 'onedrive_unavailable'],
    ['service_unavailable', 'service_unavailable'],
  ] as const)('sends a failed connection (%s) back to the File Manager with that code', async (code, expected) => {
    const { agent } = await startConnect();
    connectionFake.completeConnect.mockRejectedValue(new AuthFlowError(code, 'internal-detail-that-must-not-leak'));

    const res = await agent.get(`${BASE}/auth/microsoft/callback?code=c&state=${CONNECT_STATE}`).expect(302);

    expect(res.headers['location']).toBe(`${FRONTEND}/files?onedrive_error=${expected}`);
    expect(res.headers['location']).not.toContain('internal-detail');
  });

  it('turns an unexpected error into a generic failure, not a stack trace', async () => {
    const { agent } = await startConnect();
    connectionFake.completeConnect.mockRejectedValue(new Error('SELECT * FROM secrets failed at 10.0.0.5'));
    const res = await agent.get(`${BASE}/auth/microsoft/callback?code=c&state=${CONNECT_STATE}`).expect(302);
    expect(res.headers['location']).toBe(`${FRONTEND}/files?onedrive_error=login_failed`);
    expect(res.headers['location']).not.toMatch(/SELECT|10\.0\.0\.5/);
  });

  it('reports the user cancelling at Microsoft on the File Manager page, and uses up the state', async () => {
    const { agent } = await startConnect();
    const cancelled = await agent
      .get(
        `${BASE}/auth/microsoft/callback?error=access_denied&error_description=AADSTS65004+details&state=${CONNECT_STATE}`,
      )
      .expect(302);
    expect(cancelled.headers['location']).toBe(`${FRONTEND}/files?onedrive_error=access_denied`);
    expect(connectionFake.completeConnect).not.toHaveBeenCalled();

    const replay = await agent.get(`${BASE}/auth/microsoft/callback?code=c&state=${CONNECT_STATE}`).expect(302);
    expect(replay.headers['location']).toBe(`${FRONTEND}/?auth_error=session_expired`);
  });

  it('cannot be replayed: a second callback with the same state finishes nothing', async () => {
    const { agent } = await startConnect();
    await agent.get(`${BASE}/auth/microsoft/callback?code=c&state=${CONNECT_STATE}`).expect(302);
    const replay = await agent.get(`${BASE}/auth/microsoft/callback?code=c&state=${CONNECT_STATE}`).expect(302);
    expect(replay.headers['location']).toBe(`${FRONTEND}/?auth_error=session_expired`);
    expect(connectionFake.completeConnect).toHaveBeenCalledTimes(1);
  });

  it('only works in the browser session that started it', async () => {
    await startConnect();
    const otherBrowser = request.agent(app.getHttpServer());
    const res = await otherBrowser.get(`${BASE}/auth/microsoft/callback?code=c&state=${CONNECT_STATE}`).expect(302);
    expect(res.headers['location']).toBe(`${FRONTEND}/?auth_error=session_expired`);
    expect(connectionFake.completeConnect).not.toHaveBeenCalled();
  });

  it('does not let a sign-in redirect be used to connect storage (purpose is decided by the server)', async () => {
    memberships.set('7:1', 'owner');
    const agent = request.agent(app.getHttpServer());
    provisioning.resolveOrProvision.mockResolvedValue({ id: 7n, email: 'u7@example.com', displayName: null });
    const login = await agent.get(`${BASE}/auth/microsoft/login`).expect(302);
    const state = new URL(login.headers['location']).searchParams.get('state');

    const res = await agent
      .get(`${BASE}/auth/microsoft/callback?code=c&state=${state}&purpose=connect_onedrive&workspaceId=1`)
      .expect(302);

    expect(res.headers['location']).toBe(`${FRONTEND}/`);
    expect(connectionFake.completeConnect).not.toHaveBeenCalled();
  });
});
