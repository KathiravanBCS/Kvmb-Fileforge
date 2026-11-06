import { readdir } from 'node:fs/promises';
import { Readable } from 'node:stream';

import request from 'supertest';

import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { randomToken } from '../../common/utils/security.util';
import { PrismaService } from '../../prisma/prisma.service';
import { centralWorld, USER, type CentralWorld } from '../../testing/central-fixtures';
import { TEST_ENV } from '../../testing/test-env';
import { MicrosoftIdentityService } from '../microsoft/identity/microsoft-identity.service';
import { UserProvisioningService } from '../users/user-provisioning.service';
import { CentralStorageOneDriveService } from './central-storage-onedrive.service';
import { UPLOAD_TMP_DIR } from './central-storage.http';
import { CentralTokenVault } from './central-token-vault.service';

const FRONTEND = TEST_ENV.FRONTEND_URL;
const BASE = '/api/v1';
const PDF = Buffer.from('%PDF-1.7\n%flow test\n');
const ISSUER = 'iss';

let world: CentralWorld;
let app: NestExpressApplication;
let currentSubject = '';
let items = 0;

const identityService = { createAuthorizationRequest: jest.fn(), redeemAuthorizationCode: jest.fn() };
const provisioning = { resolveOrProvision: jest.fn() };
const storageFake = {
  usableConnection: jest.fn(),
  uploadNew: jest.fn(),
  replaceContent: jest.fn(),
  download: jest.fn(),
  deleteItem: jest.fn(),
  getItem: jest.fn(),
  findItem: jest.fn(),
  findUserFile: jest.fn(),
  health: jest.fn(),
  ensureLayout: jest.fn(),
};
const vaultFake = { findLive: jest.fn(), usableConnection: jest.fn(), withGraph: jest.fn(), saveConnected: jest.fn() };

const files = () => world.tables['central_files'];
const events = () => world.tables['events'];

beforeAll(() => {
  for (const level of ['log', 'warn', 'error'] as const)
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

beforeEach(async () => {
  world = centralWorld();
  for (const id of [USER.admin, USER.alice, USER.bob]) {
    world.tables['user_identities']?.seed({ user_id: id, issuer: ISSUER, subject: `oid-${id}` });
  }
  items = 0;

  identityService.createAuthorizationRequest.mockImplementation(() => {
    const state = randomToken();
    return Promise.resolve({
      url: `https://login.microsoftonline.com/authorize?state=${state}`,
      state,
      nonce: `n-${state}`,
      codeVerifier: `v-${state}`,
    });
  });
  identityService.redeemAuthorizationCode.mockImplementation(({ cache }: { cache?: { save(s: string): void } }) => {
    cache?.save('{"central":"cache"}');
    return Promise.resolve({
      identity: {
        provider: 'microsoft',
        issuer: ISSUER,
        subject: currentSubject,
        providerUserId: 'p',
        tenantId: 't',
        accountType: 'personal',
        homeAccountId: `home-${currentSubject}`,
        email: 'a@example.com',
        displayName: 'A',
        loginHint: 'a@example.com',
      },
      tokenCache: cache ? undefined : 'CACHE',
      scopes: ['Files.ReadWrite'],
    });
  });
  storageFake.usableConnection.mockResolvedValue({
    id: 1n,
    driveId: 'drive-1',
    rootItemId: 'r',
    usersFolderItemId: 'u',
    ownerUserId: 1n,
  });
  storageFake.uploadNew.mockImplementation((_o: bigint, stored: string, file: { size: number }) =>
    Promise.resolve({ id: `item-${++items}`, name: stored, size: file.size, eTag: 'e', cTag: 'c' }),
  );
  storageFake.replaceContent.mockImplementation((id: string, file: { size: number }) =>
    Promise.resolve({ id, size: file.size, eTag: 'e2' }),
  );
  storageFake.download.mockImplementation(() => Promise.resolve(Readable.from([Buffer.from('FILE-BYTES')])));
  storageFake.deleteItem.mockResolvedValue(undefined);
  storageFake.ensureLayout.mockResolvedValue({ driveId: 'drive-1', rootItemId: 'r', usersFolderItemId: 'u' });
  vaultFake.findLive.mockResolvedValue({
    connection_status: 'connected',
    root_folder_path: 'FileForge-Central',
    account_display_name: 'Admin',
    account_email: 'a@example.com',
    account_type: 'personal',
    last_auth_at: new Date(),
    last_verified_at: null,
    last_error_code: null,
    quota_checked_at: null,
  });
  vaultFake.saveConnected.mockResolvedValue(1n);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MicrosoftIdentityService)
    .useValue(identityService)
    .overrideProvider(UserProvisioningService)
    .useValue(provisioning)
    .overrideProvider(PrismaService)
    .useValue(world.prisma)
    .overrideProvider(CentralStorageOneDriveService)
    .useValue(storageFake)
    .overrideProvider(CentralTokenVault)
    .useValue(vaultFake)
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
interface Session {
  agent: Agent;
  csrf: string;
}

async function signInAs(userId: bigint): Promise<Session> {
  currentSubject = `oid-${userId}`;
  provisioning.resolveOrProvision.mockResolvedValue({ id: userId, email: `u${userId}@example.com`, displayName: null });
  const agent = request.agent(app.getHttpServer());
  const login = await agent.get(`${BASE}/auth/microsoft/login`).expect(302);
  const state = new URL(login.headers['location']).searchParams.get('state');
  await agent.get(`${BASE}/auth/microsoft/callback?code=c&state=${state}`).expect(302);
  const csrf = (await agent.get(`${BASE}/auth/csrf`).expect(200)).body.csrfToken as string;
  return { agent, csrf };
}

const withCsrf = (test: request.Test, { csrf }: Session) => test.set('Origin', FRONTEND).set('X-CSRF-Token', csrf);
const upload = (s: Session, url: string, name = 'doc.pdf', bytes: Buffer = PDF, method: 'post' | 'put' = 'post') =>
  withCsrf(s.agent[method](url), s).attach('file', bytes, { filename: name, contentType: 'application/octet-stream' });
const binary = (res: request.Response, done: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

const seedFile = (owner: bigint, name: string, over: Record<string, unknown> = {}) =>
  files().seed({
    connection_id: 1n,
    owner_user_id: owner,
    uploaded_by: owner,
    display_name: name,
    stored_name: `00000000-0000-4000-8000-${String(files().rows.length + 1).padStart(12, '0')}.pdf`,
    file_extension: name.split('.').pop(),
    mime_type: 'application/pdf',
    size_bytes: 100n,
    external_drive_id: 'drive-1',
    external_item_id: `seed-${files().rows.length + 1}`,
    upload_status: 'ready',
    uploaded_at: new Date(),
    ...over,
  }) as { id: bigint };

describe('authentication and CSRF come first', () => {
  it.each([
    '/central-storage/files',
    '/central-storage/usage',
    '/central-storage/capabilities',
    '/admin/central-storage/files',
    '/admin/central-storage/connection',
  ])('GET %s without a session is 401 UNAUTHENTICATED', async (path) => {
    const res = await request(app.getHttpServer()).get(`${BASE}${path}`).expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('every state-changing central route needs the CSRF token and the frontend origin', async () => {
    const alice = await signInAs(USER.alice);
    const row = seedFile(USER.alice, 'mine.pdf');
    const id = row.id.toString();
    const calls: [string, () => request.Test][] = [
      ['upload', () => alice.agent.post(`${BASE}/central-storage/files/upload`).attach('file', PDF, 'a.pdf')],
      ['rename', () => alice.agent.patch(`${BASE}/central-storage/files/${id}`).send({ name: 'x.pdf' })],
      ['replace', () => alice.agent.put(`${BASE}/central-storage/files/${id}/content`).attach('file', PDF, 'a.pdf')],
      ['delete', () => alice.agent.delete(`${BASE}/central-storage/files/${id}`)],
    ];
    for (const [, run] of calls) {
      expect((await run()).body.error.code).toBe('CSRF_TOKEN_INVALID');
      expect((await run().set('Origin', 'https://evil.example').set('X-CSRF-Token', alice.csrf)).body.error.code).toBe(
        'CSRF_ORIGIN_MISMATCH',
      );
    }
    expect(files().rows).toHaveLength(1);
    expect(storageFake.deleteItem).not.toHaveBeenCalled();
    expect(storageFake.uploadNew).not.toHaveBeenCalled();
  });
});

describe('My Files (a normal user)', () => {
  it('uploads, lists, reads, previews, downloads, renames, replaces and deletes their own file', async () => {
    const alice = await signInAs(USER.alice);

    const created = await upload(alice, `${BASE}/central-storage/files/upload`, 'Report.pdf').expect(201);
    expect(created.body).toMatchObject({
      name: 'Report.pdf',
      mimeType: 'application/pdf',
      ownerId: '2',
      status: 'ready',
      previewable: true,
    });
    expect(JSON.stringify(created.body)).not.toMatch(/item-1|stored|drive-1/); // no OneDrive ids or stored names to the browser
    const id = created.body.id as string;

    const list = await alice.agent
      .get(`${BASE}/central-storage/files?search=report&type=pdf&sort=name&order=asc`)
      .expect(200);
    expect(list.body).toMatchObject({ total: 1, page: 1, pageSize: 25 });
    await alice.agent.get(`${BASE}/central-storage/files/${id}`).expect(200);
    expect((await alice.agent.get(`${BASE}/central-storage/usage`).expect(200)).body).toEqual({
      fileCount: 1,
      totalBytes: PDF.length,
    });

    const preview = await alice.agent
      .get(`${BASE}/central-storage/files/${id}/preview`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(preview.headers['content-type']).toBe('application/pdf');
    expect(preview.headers['content-disposition']).toMatch(/^inline;/);
    expect(preview.headers['x-content-type-options']).toBe('nosniff');
    expect(preview.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(preview.headers['cache-control']).toBe('private, no-store');

    const download = await alice.agent
      .get(`${BASE}/central-storage/files/${id}/download`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(download.headers['content-type']).toBe('application/octet-stream');
    expect(download.headers['content-disposition']).toMatch(/^attachment; filename="Report\.pdf"/);
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.headers['cache-control']).toBe('no-store');
    expect((download.body as Buffer).toString()).toBe('FILE-BYTES');

    expect(
      (
        await withCsrf(alice.agent.patch(`${BASE}/central-storage/files/${id}`), alice)
          .send({ name: 'Final.pdf' })
          .expect(200)
      ).body.name,
    ).toBe('Final.pdf');
    expect(
      (
        await upload(
          alice,
          `${BASE}/central-storage/files/${id}/content`,
          'x.pdf',
          Buffer.from('%PDF-1.4\nv2\n'),
          'put',
        ).expect(200)
      ).body.contentVersion,
    ).toBe(2);
    await withCsrf(alice.agent.delete(`${BASE}/central-storage/files/${id}`), alice).expect(204);
    await alice.agent.get(`${BASE}/central-storage/files/${id}`).expect(404);
  });

  it('inline preview is refused for anything that is not a verified image, PDF or text (HTML cannot run on this origin)', async () => {
    const alice = await signInAs(USER.alice);
    const html = await upload(
      alice,
      `${BASE}/central-storage/files/upload`,
      'page.html',
      Buffer.from('<script>alert(1)</script>'),
    ).expect(201);
    expect(html.body.previewable).toBe(false);
    const res = await alice.agent.get(`${BASE}/central-storage/files/${html.body.id}/preview`).expect(415);
    expect(res.body.error.code).toBe('PREVIEW_NOT_SUPPORTED');
    // ...but it downloads, always as an attachment.
    const download = await alice.agent.get(`${BASE}/central-storage/files/${html.body.id}/download`).expect(200);
    expect(download.headers['content-disposition']).toMatch(/^attachment/);
  });

  it('rejects bad uploads with clear errors and leaves nothing behind (database, OneDrive or temporary files)', async () => {
    const alice = await signInAs(USER.alice);
    const tmpBefore = await readdir(UPLOAD_TMP_DIR);
    const url = `${BASE}/central-storage/files/upload`;

    expect((await withCsrf(alice.agent.post(url), alice).expect(400)).body.error.code).toBe('FILE_REQUIRED');
    expect((await upload(alice, url, 'setup.exe', Buffer.from('MZ')).expect(400)).body.error.code).toBe(
      'FILE_TYPE_NOT_ALLOWED',
    );
    expect(
      (await upload(alice, url, 'fake.pdf', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).expect(400))
        .body.error.code,
    ).toBe('FILE_CONTENT_MISMATCH');
    expect((await upload(alice, url, 'empty.txt', Buffer.alloc(0)).expect(400)).body.error.code).toBe('EMPTY_FILE');
    const tooBig = await upload(alice, url, 'huge.bin', Buffer.alloc(50 * 1024 * 1024 + 1024, 1));
    expect(tooBig.status).toBe(413);

    expect(files().rows).toHaveLength(0);
    expect(storageFake.uploadNew).not.toHaveBeenCalled();
    expect(await readdir(UPLOAD_TMP_DIR)).toEqual(tmpBefore);
  });

  it('never accepts an owner from the browser: a user id in the query or body changes nothing', async () => {
    const alice = await signInAs(USER.alice);
    seedFile(USER.bob, 'bob.pdf');
    const list = await alice.agent.get(`${BASE}/central-storage/files?ownerUserId=3&userId=3&owner=3`).expect(200);
    expect(list.body.total).toBe(0);
    const created = await withCsrf(
      alice.agent.post(`${BASE}/central-storage/files/upload?ownerUserId=3&userId=3`),
      alice,
    )
      .field('ownerUserId', '3')
      .attach('file', PDF, 'a.pdf')
      .expect(201);
    expect(created.body.ownerId).toBe('2');
    expect(storageFake.uploadNew.mock.calls[0]?.[0]).toBe(USER.alice);
  });

  it('reports what the user can do (and never that an ordinary user is an administrator)', async () => {
    const alice = await signInAs(USER.alice);
    expect((await alice.agent.get(`${BASE}/central-storage/capabilities`).expect(200)).body).toEqual({
      isSystemAdmin: false,
      available: true,
      maxFileBytes: 52428800,
    });
    const admin = await signInAs(USER.admin);
    expect((await admin.agent.get(`${BASE}/central-storage/capabilities`).expect(200)).body.isSystemAdmin).toBe(true);
  });
});

describe('Alice cannot reach Bob’s files by any route', () => {
  it('every operation on Bob’s file id is the same 404 as a file that does not exist', async () => {
    const alice = await signInAs(USER.alice);
    const bobs = seedFile(USER.bob, 'bob-private.pdf');
    const snapshot = JSON.stringify(files().rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

    const attempts = (id: string): [string, () => request.Test][] => [
      ['get', () => alice.agent.get(`${BASE}/central-storage/files/${id}`)],
      ['download', () => alice.agent.get(`${BASE}/central-storage/files/${id}/download`)],
      ['preview', () => alice.agent.get(`${BASE}/central-storage/files/${id}/preview`)],
      [
        'rename',
        () => withCsrf(alice.agent.patch(`${BASE}/central-storage/files/${id}`), alice).send({ name: 'mine.pdf' }),
      ],
      ['replace', () => upload(alice, `${BASE}/central-storage/files/${id}/content`, 'x.pdf', PDF, 'put')],
      ['delete', () => withCsrf(alice.agent.delete(`${BASE}/central-storage/files/${id}`), alice)],
    ];
    for (const [name, run] of attempts(bobs.id.toString())) {
      const theirs = await run();
      const missing = await attempts('987654')[attempts(bobs.id.toString()).findIndex(([n]) => n === name)]?.[1]();
      expect([name, theirs.status, theirs.body.error.code]).toEqual([name, 404, 'FILE_NOT_FOUND']);
      expect(theirs.body.error.message).toBe(missing?.body.error.message);
    }
    expect(storageFake.download).not.toHaveBeenCalled();
    expect(storageFake.replaceContent).not.toHaveBeenCalled();
    expect(storageFake.deleteItem).not.toHaveBeenCalled();
    expect(JSON.stringify(files().rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(snapshot);
  });

  it.each(['abc', '1%20OR%201=1', '99999999999999999999'])('a malformed id %j is a plain 404', async (raw) => {
    const alice = await signInAs(USER.alice);
    expect((await alice.agent.get(`${BASE}/central-storage/files/${raw}`).expect(404)).body.error.code).toBe(
      'FILE_NOT_FOUND',
    );
  });

  it('a workspace owner (everyone owns a personal workspace) cannot use any administrator route', async () => {
    const alice = await signInAs(USER.alice);
    const bobs = seedFile(USER.bob, 'bob.pdf');
    const id = bobs.id.toString();
    const attempts: [string, () => request.Test][] = [
      ['list', () => alice.agent.get(`${BASE}/admin/central-storage/files`)],
      ['get', () => alice.agent.get(`${BASE}/admin/central-storage/files/${id}`)],
      ['download', () => alice.agent.get(`${BASE}/admin/central-storage/files/${id}/download`)],
      ['preview', () => alice.agent.get(`${BASE}/admin/central-storage/files/${id}/preview`)],
      [
        'rename',
        () => withCsrf(alice.agent.patch(`${BASE}/admin/central-storage/files/${id}`), alice).send({ name: 'x.pdf' }),
      ],
      ['replace', () => upload(alice, `${BASE}/admin/central-storage/files/${id}/content`, 'x.pdf', PDF, 'put')],
      ['delete', () => withCsrf(alice.agent.delete(`${BASE}/admin/central-storage/files/${id}`), alice)],
      ['resync', () => withCsrf(alice.agent.post(`${BASE}/admin/central-storage/files/${id}/resync`), alice)],
      ['upload for user', () => upload(alice, `${BASE}/admin/central-storage/users/3/files/upload`)],
      ['users', () => alice.agent.get(`${BASE}/admin/central-storage/users`)],
      ['one user’s files', () => alice.agent.get(`${BASE}/admin/central-storage/users/3/files`)],
      ['usage', () => alice.agent.get(`${BASE}/admin/central-storage/usage`)],
      ['connection', () => alice.agent.get(`${BASE}/admin/central-storage/connection`)],
      ['connect', () => withCsrf(alice.agent.post(`${BASE}/admin/central-storage/connection/connect`), alice)],
      ['verify', () => withCsrf(alice.agent.post(`${BASE}/admin/central-storage/connection/verify`), alice)],
    ];
    const microsoftRedirectsBefore = identityService.createAuthorizationRequest.mock.calls.length; // the sign-in itself
    for (const [name, run] of attempts) {
      const res = await run();
      expect([name, res.status, res.body.error.code]).toEqual([name, 403, 'SYSTEM_ADMIN_REQUIRED']);
    }
    expect(files().rows).toHaveLength(1);
    expect(files().rows[0]).toMatchObject({ is_deleted: false, upload_status: 'ready', display_name: 'bob.pdf' });
    for (const fn of Object.values(storageFake)) expect(fn).not.toHaveBeenCalled();
    expect(identityService.createAuthorizationRequest.mock.calls.length).toBe(microsoftRedirectsBefore); // no Microsoft redirect was started
    expect(events().rows).toHaveLength(0);
  });
});

describe('the system administrator', () => {
  it('sees every user’s files with their owners, and can filter by user', async () => {
    seedFile(USER.alice, 'alice.pdf');
    seedFile(USER.bob, 'bob.pdf');
    const admin = await signInAs(USER.admin);

    const all = await admin.agent.get(`${BASE}/admin/central-storage/files?sort=name&order=asc`).expect(200);
    expect(all.body.items.map((i: { name: string; owner: { email: string } }) => [i.name, i.owner.email])).toEqual([
      ['alice.pdf', 'alice@example.com'],
      ['bob.pdf', 'bob@example.com'],
    ]);
    expect((await admin.agent.get(`${BASE}/admin/central-storage/files?ownerUserId=3`).expect(200)).body.total).toBe(1);
    expect((await admin.agent.get(`${BASE}/admin/central-storage/users/3/files`).expect(200)).body.items[0].name).toBe(
      'bob.pdf',
    );
    const users = await admin.agent.get(`${BASE}/admin/central-storage/users`).expect(200);
    expect(users.body.map((u: { id: string; fileCount: number }) => [u.id, u.fileCount])).toEqual([
      ['1', 0],
      ['2', 1],
      ['3', 1],
    ]);
    const usage = await admin.agent.get(`${BASE}/admin/central-storage/usage`).expect(200);
    expect(usage.body.total).toEqual({ fileCount: 2, totalBytes: 200 });
  });

  it('downloads, previews, renames, replaces and deletes any user’s file - and each one is audited', async () => {
    const bobs = seedFile(USER.bob, 'bob.pdf');
    const id = bobs.id.toString();
    const admin = await signInAs(USER.admin);

    await admin.agent.get(`${BASE}/admin/central-storage/files/${id}/download`).expect(200);
    await admin.agent.get(`${BASE}/admin/central-storage/files/${id}/preview`).expect(200);
    await withCsrf(admin.agent.patch(`${BASE}/admin/central-storage/files/${id}`), admin)
      .send({ name: 'renamed.pdf' })
      .expect(200);
    await upload(
      admin,
      `${BASE}/admin/central-storage/files/${id}/content`,
      'n.pdf',
      Buffer.from('%PDF-1.4\nx\n'),
      'put',
    ).expect(200);
    await withCsrf(admin.agent.delete(`${BASE}/admin/central-storage/files/${id}`), admin).expect(204);

    expect(events().rows.map((e) => e['action'])).toEqual([
      'central_storage.file.download',
      'central_storage.file.preview',
      'central_storage.file.rename',
      'central_storage.file.replace',
      'central_storage.file.delete',
    ]);
    expect(events().rows.every((e) => e['actor_user_id'] === USER.admin && e['actor_type'] === 'system_admin')).toBe(
      true,
    );
    expect(typeof events().rows[0]?.['request_id']).toBe('string'); // the server-generated request id
  });

  it('uploads a file for a selected user: owned by that user, uploaded by the administrator', async () => {
    const admin = await signInAs(USER.admin);
    const res = await upload(admin, `${BASE}/admin/central-storage/users/3/files/upload`, 'for-bob.pdf').expect(201);
    expect(res.body).toMatchObject({ ownerId: '3', uploadedById: '1', owner: { email: 'bob@example.com' } });
    expect(storageFake.uploadNew.mock.calls[0]?.[0]).toBe(USER.bob);

    await upload(admin, `${BASE}/admin/central-storage/users/4/files/upload`).expect(404); // deactivated user
    await upload(admin, `${BASE}/admin/central-storage/users/99/files/upload`).expect(404);
    await upload(admin, `${BASE}/admin/central-storage/users/abc/files/upload`).expect(404);
    expect(files().rows).toHaveLength(1);
  });

  it('is locked out the moment the grant is revoked, with the same session', async () => {
    const admin = await signInAs(USER.admin);
    await admin.agent.get(`${BASE}/admin/central-storage/files`).expect(200);
    (world.tables['system_admins']?.rows[0] as Record<string, unknown>)['is_active'] = false;
    for (const path of ['/files', '/users', '/usage', '/connection']) {
      expect((await admin.agent.get(`${BASE}/admin/central-storage${path}`).expect(403)).body.error.code).toBe(
        'SYSTEM_ADMIN_REQUIRED',
      );
    }
    // ...but My Files still works for them as an ordinary user.
    await admin.agent.get(`${BASE}/central-storage/files`).expect(200);
  });

  it('shows the central connection without any secret', async () => {
    const admin = await signInAs(USER.admin);
    const res = await admin.agent.get(`${BASE}/admin/central-storage/connection`).expect(200);
    expect(res.body).toMatchObject({ status: 'connected', usable: true, account: { email: 'a@example.com' } });
    expect(JSON.stringify(res.body)).not.toMatch(/token|cipher|nonce|secret/i);
  });
});

describe('connecting the central OneDrive through the Microsoft redirect', () => {
  async function connectAs(userId: bigint) {
    const session = await signInAs(userId);
    const res = await withCsrf(session.agent.post(`${BASE}/admin/central-storage/connection/connect`), session);
    return { session, res };
  }

  it('an administrator is sent to Microsoft and comes back connected', async () => {
    const { session, res } = await connectAs(USER.admin);
    expect(res.status).toBe(200);
    const state = new URL(res.body.url).searchParams.get('state');

    const callback = await session.agent.get(`${BASE}/auth/microsoft/callback?code=c&state=${state}`).expect(302);
    expect(callback.headers['location']).toBe(`${FRONTEND}/admin/storage/settings?central=connected`);
    expect(vaultFake.saveConnected).toHaveBeenCalledTimes(1);
    const [account, layout, scopes] = vaultFake.saveConnected.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
      string[],
    ];
    expect(account).toMatchObject({ ownerUserId: USER.admin, issuer: ISSUER, subject: `oid-${USER.admin}` });
    expect(layout).toEqual({ driveId: 'drive-1', rootItemId: 'r', usersFolderItemId: 'u' });
    expect(scopes).toContain('Files.ReadWrite');
  });

  it('the redirect is single use: replaying it does nothing', async () => {
    const { session, res } = await connectAs(USER.admin);
    const state = new URL(res.body.url).searchParams.get('state');
    await session.agent.get(`${BASE}/auth/microsoft/callback?code=c&state=${state}`).expect(302);
    const replay = await session.agent.get(`${BASE}/auth/microsoft/callback?code=c&state=${state}`).expect(302);
    expect(replay.headers['location']).toBe(`${FRONTEND}/?auth_error=session_expired`);
    expect(vaultFake.saveConnected).toHaveBeenCalledTimes(1);
  });

  it('consenting with a different Microsoft account than the one signed in sends the administrator back with account_mismatch', async () => {
    const { session, res } = await connectAs(USER.admin);
    const state = new URL(res.body.url).searchParams.get('state');
    currentSubject = 'oid-a-different-account';
    const callback = await session.agent.get(`${BASE}/auth/microsoft/callback?code=c&state=${state}`).expect(302);
    expect(callback.headers['location']).toBe(`${FRONTEND}/admin/storage/settings?central_error=account_mismatch`);
    expect(vaultFake.saveConnected).not.toHaveBeenCalled();
  });

  it('cancelling at Microsoft returns to the settings page, not to the sign-in or File Manager page', async () => {
    const { session, res } = await connectAs(USER.admin);
    const state = new URL(res.body.url).searchParams.get('state');
    const callback = await session.agent
      .get(`${BASE}/auth/microsoft/callback?error=access_denied&state=${state}`)
      .expect(302);
    expect(callback.headers['location']).toBe(`${FRONTEND}/admin/storage/settings?central_error=access_denied`);
  });

  it('a user whose administrator grant is revoked while at Microsoft cannot finish connecting', async () => {
    const { session, res } = await connectAs(USER.admin);
    const state = new URL(res.body.url).searchParams.get('state');
    (world.tables['system_admins']?.rows[0] as Record<string, unknown>)['is_active'] = false;
    const callback = await session.agent.get(`${BASE}/auth/microsoft/callback?code=c&state=${state}`).expect(302);
    expect(callback.headers['location']).toBe(
      `${FRONTEND}/admin/storage/settings?central_error=central_storage_forbidden`,
    );
    expect(vaultFake.saveConnected).not.toHaveBeenCalled();
  });

  it('an ordinary user cannot start it at all', async () => {
    const { res } = await connectAs(USER.alice);
    expect(res.status).toBe(403);
    expect(identityService.createAuthorizationRequest).toHaveBeenCalledTimes(1); // only the sign-in redirect itself
  });

  it('regression: normal sign-in is unchanged (success to "/", failure to ?auth_error)', async () => {
    const agent = request.agent(app.getHttpServer());
    currentSubject = 'oid-2';
    provisioning.resolveOrProvision.mockResolvedValue({ id: USER.alice, email: 'a@example.com', displayName: null });
    const login = await agent.get(`${BASE}/auth/microsoft/login`).expect(302);
    const state = new URL(login.headers['location']).searchParams.get('state');
    expect(
      (await agent.get(`${BASE}/auth/microsoft/callback?code=c&state=${state}`).expect(302)).headers['location'],
    ).toBe(`${FRONTEND}/`);

    const other = request.agent(app.getHttpServer());
    const login2 = await other.get(`${BASE}/auth/microsoft/login`).expect(302);
    const state2 = new URL(login2.headers['location']).searchParams.get('state');
    const denied = await other.get(`${BASE}/auth/microsoft/callback?error=access_denied&state=${state2}`).expect(302);
    expect(denied.headers['location']).toBe(`${FRONTEND}/?auth_error=access_denied`);
  });
});

describe('upload admission control (HTTP)', () => {
  const slots = () => world.tables['central_upload_slots'].rows;
  const settled = async (predicate: () => boolean) => {
    for (let i = 0; i < 100 && !predicate(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  };
  const open = () => slots().filter((slot) => slot['released_at'] === null);

  it('refuses the 11th upload in 10 minutes with 429, a Retry-After header and a retry time, before reading the file', async () => {
    const alice = await signInAs(USER.alice);
    const url = `${BASE}/central-storage/files/upload`;
    for (let i = 0; i < 10; i += 1) {
      await upload(alice, url, `f${i}.pdf`).expect(201);
      await settled(() => open().length === 0);
    }
    const res = await upload(alice, url, 'eleventh.pdf').expect(429);
    expect(res.body.error).toMatchObject({ code: 'UPLOAD_RATE_LIMITED', retryAfterSeconds: expect.any(Number) });
    expect(Number(res.headers['retry-after'])).toBe(res.body.error.retryAfterSeconds);
    expect(res.body.error.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.body.error.requestId).toEqual(expect.any(String));
    expect(storageFake.uploadNew).toHaveBeenCalledTimes(10);
    expect(files().rows).toHaveLength(10);
  });

  it('does not slow other users down', async () => {
    const alice = await signInAs(USER.alice);
    const bob = await signInAs(USER.bob);
    for (let i = 0; i < 10; i += 1) {
      await upload(alice, `${BASE}/central-storage/files/upload`, `a${i}.pdf`).expect(201);
      await settled(() => open().length === 0);
    }
    await upload(alice, `${BASE}/central-storage/files/upload`).expect(429);
    await upload(bob, `${BASE}/central-storage/files/upload`).expect(201);
  });

  it('limits replacements separately: 10 uploads do not use up the 10 replacements', async () => {
    const alice = await signInAs(USER.alice);
    const row = seedFile(USER.alice, 'mine.pdf');
    for (let i = 0; i < 10; i += 1) {
      await upload(alice, `${BASE}/central-storage/files/upload`, `a${i}.pdf`).expect(201);
      await settled(() => open().length === 0);
    }
    await upload(alice, `${BASE}/central-storage/files/${row.id}/content`, 'new.pdf', PDF, 'put').expect(200);
    await settled(() => open().length === 0);
    expect(
      slots()
        .map((slot) => slot['operation'])
        .filter((operation) => operation === 'replace'),
    ).toHaveLength(1);
  });

  it("counts administrator uploads for a user under the administrator allowance, not the user's", async () => {
    const admin = await signInAs(USER.admin);
    await upload(admin, `${BASE}/admin/central-storage/users/3/files/upload`).expect(201);
    await settled(() => open().length === 0);
    expect(slots()[0]).toMatchObject({ user_id: USER.admin, operation: 'admin_upload', outcome: 'completed' });
  });

  it('releases the slot after success, after a failed upload, and keeps the record', async () => {
    const alice = await signInAs(USER.alice);
    await upload(alice, `${BASE}/central-storage/files/upload`, 'ok.pdf').expect(201);
    await upload(alice, `${BASE}/central-storage/files/upload`, 'setup.exe', Buffer.from('MZ')).expect(400);
    await settled(() => open().length === 0 && slots().length === 2);
    expect(
      slots()
        .map((slot) => slot['outcome'])
        .sort(),
    ).toEqual(['completed', 'failed']);
    expect(slots().every((slot) => typeof slot['lease_token'] === 'string')).toBe(true);
  });

  it('allows 3 running uploads per user and refuses a 4th with 429 until one finishes', async () => {
    const alice = await signInAs(USER.alice);
    const gates: (() => void)[] = [];
    storageFake.uploadNew.mockImplementation(
      (_o: bigint, stored: string, file: { size: number }) =>
        new Promise((resolve) => {
          gates.push(() => resolve({ id: `item-${++items}`, name: stored, size: file.size, eTag: 'e', cTag: 'c' }));
        }),
    );
    const running = [0, 1, 2].map((i) =>
      upload(alice, `${BASE}/central-storage/files/upload`, `r${i}.pdf`).then((r) => r),
    );
    await settled(() => gates.length === 3);
    expect(open()).toHaveLength(3);

    const refused = await upload(alice, `${BASE}/central-storage/files/upload`, 'fourth.pdf').expect(429);
    expect(refused.body.error.code).toBe('UPLOAD_TOO_MANY_ACTIVE');
    expect(refused.headers['retry-after']).toBeDefined();
    expect(gates).toHaveLength(3); // the fourth file was never processed

    gates.forEach((release) => release());
    const finished = await Promise.all(running);
    expect(finished.map((r) => r.status)).toEqual([201, 201, 201]);
    await settled(() => open().length === 0);
    storageFake.uploadNew.mockImplementation((_o: bigint, stored: string, file: { size: number }) =>
      Promise.resolve({ id: `item-${++items}`, name: stored, size: file.size, eTag: 'e', cTag: 'c' }),
    );
    await upload(alice, `${BASE}/central-storage/files/upload`, 'fifth.pdf').expect(201);
  });

  it('frees the slot when the browser abandons the upload midway', async () => {
    const alice = await signInAs(USER.alice);
    let started: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => (started = resolve));
    storageFake.uploadNew.mockImplementation(() => {
      started();
      return new Promise(() => undefined); // never finishes
    });
    const pending = upload(alice, `${BASE}/central-storage/files/upload`, 'slow.pdf');
    const outcome = pending.then(
      () => 'finished',
      () => 'aborted',
    );
    await reached;
    expect(open()).toHaveLength(1);
    pending.abort();
    await outcome;
    await settled(() => open().length === 0);
    expect(slots()[0]).toMatchObject({ outcome: 'cancelled' });
  });

  it('takes no capacity from requests refused earlier (no session, no CSRF, not an administrator, too large)', async () => {
    const alice = await signInAs(USER.alice);
    await request(app.getHttpServer())
      .post(`${BASE}/central-storage/files/upload`)
      .attach('file', PDF, 'a.pdf')
      .expect(401);
    await alice.agent.post(`${BASE}/central-storage/files/upload`).attach('file', PDF, 'a.pdf').expect(403);
    await upload(alice, `${BASE}/admin/central-storage/users/3/files/upload`).expect(403);
    // A request that DECLARES more than the limit is refused from its headers alone (the body is never read).
    const huge = await withCsrf(alice.agent.post(`${BASE}/central-storage/files/upload`), alice)
      .set('Content-Type', 'application/octet-stream')
      .set('Content-Length', String(52 * 1024 * 1024))
      .send(Buffer.from('x'));
    expect(huge.status).toBe(413);
    expect(huge.body.error.code).toBe('FILE_TOO_LARGE');
    expect(slots()).toHaveLength(0);
    expect(storageFake.uploadNew).not.toHaveBeenCalled();
  });

  it('does not affect reads: listing and downloading work while uploads are at their limit', async () => {
    const alice = await signInAs(USER.alice);
    const row = seedFile(USER.alice, 'mine.pdf');
    for (let i = 0; i < 10; i += 1) {
      await upload(alice, `${BASE}/central-storage/files/upload`, `a${i}.pdf`).expect(201);
      await settled(() => open().length === 0);
    }
    await upload(alice, `${BASE}/central-storage/files/upload`).expect(429);
    await alice.agent.get(`${BASE}/central-storage/files`).expect(200);
    await alice.agent.get(`${BASE}/central-storage/files/${row.id}`).expect(200);
  });
});

describe('recovery administration (HTTP)', () => {
  const R = `${BASE}/admin/central-storage/recovery`;
  const stuck = (over: Record<string, unknown> = {}) =>
    seedFile(USER.alice, 'stuck.pdf', {
      upload_status: 'uploading',
      external_item_id: null,
      created_at: new Date(Date.now() - 3 * 60 * 60_000),
      updated_at: new Date(Date.now() - 3 * 60 * 60_000),
      ...over,
    });

  it.each([
    ['get', '/summary'],
    ['get', '/items'],
    ['get', '/items/1'],
    ['post', '/items/1/retry'],
    ['post', '/items/1/dismiss'],
  ] as const)('%s %s needs a session', async (method, path) => {
    const res = await request(app.getHttpServer())[method](`${R}${path}`).set('Origin', FRONTEND);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each([
    ['get', '/summary'],
    ['get', '/items'],
    ['get', '/items/1'],
    ['post', '/items/1/retry'],
    ['post', '/items/1/dismiss'],
  ] as const)('an ordinary user gets 403 on %s %s', async (method, path) => {
    const alice = await signInAs(USER.alice);
    const row = stuck();
    const res = await withCsrf(alice.agent[method](`${R}${path.replace('/1', `/${row.id}`)}`), alice);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SYSTEM_ADMIN_REQUIRED');
    expect(storageFake.findUserFile).not.toHaveBeenCalled();
    expect(files().rows[0]).toMatchObject({ upload_status: 'uploading', needs_review: false });
  });

  it('the state-changing routes need the CSRF token and the frontend origin', async () => {
    const admin = await signInAs(USER.admin);
    const row = stuck();
    for (const action of ['retry', 'dismiss']) {
      const url = `${R}/items/${row.id}/${action}`;
      expect((await admin.agent.post(url)).body.error.code).toBe('CSRF_TOKEN_INVALID');
      expect(
        (await admin.agent.post(url).set('Origin', 'https://evil.example').set('X-CSRF-Token', admin.csrf)).body.error
          .code,
      ).toBe('CSRF_ORIGIN_MISMATCH');
    }
    expect(storageFake.findUserFile).not.toHaveBeenCalled();
    expect(events().rows).toHaveLength(0);
  });

  it('an administrator sees the summary, the list and one file, without any OneDrive identifiers', async () => {
    const admin = await signInAs(USER.admin);
    const row = stuck({ stored_name: 'STORED-NAME-SECRET.pdf' });

    const summary = await admin.agent.get(`${R}/summary`).expect(200);
    expect(summary.body).toMatchObject({ waiting: 1, needsReview: 0, worker: { enabled: false } });

    const list = await admin.agent.get(`${R}/items?state=waiting`).expect(200);
    expect(list.body).toMatchObject({
      total: 1,
      items: [{ id: String(row.id), status: 'uploading', state: 'waiting' }],
    });

    const detail = await admin.agent.get(`${R}/items/${row.id}`).expect(200);
    expect(detail.body.item.owner).toMatchObject({ email: 'alice@example.com' });
    expect(JSON.stringify([summary.body, list.body, detail.body])).not.toContain('STORED-NAME-SECRET');

    await admin.agent.get(`${R}/items?state=bogus`).expect(400);
    await admin.agent.get(`${R}/items/abc`).expect(404);
  });

  it('retry runs the recovery and the result is visible; dismiss clears a review without touching OneDrive', async () => {
    const admin = await signInAs(USER.admin);
    const row = stuck();
    storageFake.findUserFile.mockResolvedValue({ id: 'item-r', size: 100, eTag: 'e', cTag: 'c', file: {} });

    const retried = await withCsrf(admin.agent.post(`${R}/items/${row.id}/retry`), admin).expect(200);
    expect(retried.body).toMatchObject({ outcome: 'repaired', item: { status: 'ready' } });
    expect(files().rows[0]).toMatchObject({ upload_status: 'ready', external_item_id: 'item-r' });
    expect(events().rows.map((e) => e['action'])).toEqual([
      'central_storage.recovery.retry_requested',
      'central_storage.recovery.repaired',
    ]);
    await withCsrf(admin.agent.post(`${R}/items/${row.id}/retry`), admin).expect(409); // nothing left to recover

    const parked = stuck({
      needs_review: true,
      review_reason: 'orphan_onedrive_item',
      upload_status: 'failed',
      is_deleted: true,
    });
    const dismissed = await withCsrf(admin.agent.post(`${R}/items/${parked.id}/dismiss`), admin).expect(200);
    expect(dismissed.body.item.state).not.toBe('needs_review');
    expect(storageFake.deleteItem).not.toHaveBeenCalled();
  });

  it('regression: ordinary file routes and the user views are unchanged by the recovery fields', async () => {
    const alice = await signInAs(USER.alice);
    stuck({ needs_review: true, review_reason: 'size_mismatch' });
    const mine = seedFile(USER.alice, 'fine.pdf');
    const list = await alice.agent.get(`${BASE}/central-storage/files`).expect(200);
    expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([String(mine.id)]); // interrupted files stay hidden
    expect(JSON.stringify(list.body)).not.toMatch(/needs_review|reviewReason|recovery|lease/i);
  });
});
