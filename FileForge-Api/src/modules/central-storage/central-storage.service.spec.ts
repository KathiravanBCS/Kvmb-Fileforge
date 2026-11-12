import { createHash } from 'node:crypto';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { HttpException, Logger } from '@nestjs/common';

import type { PrismaService } from '../../prisma/prisma.service';
import { centralWorld, USER } from '../../testing/central-fixtures';
import type { FakeTable } from '../../testing/fake-prisma';
import { CentralStorageAccessService } from './central-storage-access.service';
import { CentralStorageAuditService } from './central-storage-audit.service';
import type { CentralStorageOneDriveService } from './central-storage-onedrive.service';
import { CENTRAL_MAX_FILE_BYTES } from './central-storage.constants';
import { CentralStorageService, parseFileId } from './central-storage.service';
import type { ListQuery } from './dto/central-storage.dto';
import type { Actor, IncomingFile } from './types/central-storage.types';

const PDF = Buffer.from('%PDF-1.7\n%test\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const connection = { id: 1n, driveId: 'drive-1', rootItemId: 'root-1', usersFolderItemId: 'users-1', ownerUserId: 1n };
const sessionUser = (id: bigint) => ({ id: id.toString(), email: `u${id}@example.com`, displayName: null });
const defaultQuery: ListQuery = { page: 1, pageSize: 25, sort: 'date', order: 'desc' };

let tempDir: string;
beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'central-service-'));
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

let counter = 0;
async function incoming(name: string, bytes: Buffer = PDF, size = bytes.length): Promise<IncomingFile> {
  const path = join(tempDir, `upload-${counter++}`);
  await writeFile(path, bytes);
  return { path, originalName: name, size };
}
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

function fakeStorage() {
  let items = 0;
  return {
    usableConnection: jest.fn().mockResolvedValue(connection),
    uploadNew: jest.fn((_owner: bigint, stored: string, file: { size: number }) =>
      Promise.resolve({
        id: `item-${++items}`,
        name: stored,
        size: file.size,
        eTag: 'e1',
        cTag: 'c1',
        createdDateTime: '2026-11-05T10:00:00Z',
        lastModifiedDateTime: '2026-11-05T10:00:00Z',
      }),
    ),
    replaceContent: jest.fn((itemId: string, file: { size: number }) =>
      Promise.resolve({
        id: itemId,
        size: file.size,
        eTag: 'e2',
        cTag: 'c2',
        lastModifiedDateTime: '2026-11-05T12:00:00Z',
      }),
    ),
    download: jest.fn(() => Promise.resolve(Readable.from([Buffer.from('BYTES')]))),
    deleteItem: jest.fn().mockResolvedValue(undefined),
    getItem: jest.fn(),
  };
}

async function setup() {
  const world = centralWorld();
  const prisma = world.prisma as unknown as PrismaService;
  const accessService = new CentralStorageAccessService(prisma);
  const audit = new CentralStorageAuditService(prisma);
  const storage = fakeStorage();
  const service = new CentralStorageService(
    prisma,
    storage as unknown as CentralStorageOneDriveService,
    accessService,
    audit,
  );
  const files = world.tables['central_files'];
  const events = world.tables['events'];
  const actors = {
    alice: await accessService.userActor(sessionUser(USER.alice)),
    bob: await accessService.userActor(sessionUser(USER.bob)),
    admin: await accessService.adminActor(sessionUser(USER.admin), { requestId: 'req-1', ip: '127.0.0.1' }),
  };

  let seeded = 0;
  /** A finished upload, as the database would hold it. */
  const seedFile = (owner: bigint, name: string, over: Record<string, unknown> = {}) => {
    const n = ++seeded;
    const extension = name.includes('.') ? name.split('.').pop() : null;
    return files.seed({
      connection_id: 1n,
      owner_user_id: owner,
      uploaded_by: owner,
      display_name: name,
      stored_name: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}${extension ? `.${extension}` : ''}`,
      file_extension: extension,
      mime_type: extension === 'pdf' ? 'application/pdf' : 'application/octet-stream',
      size_bytes: 1000n * BigInt(n),
      external_drive_id: 'drive-1',
      external_item_id: `seed-item-${n}`,
      upload_status: 'ready',
      uploaded_at: new Date(),
      created_at: new Date(Date.now() + n * 1000),
      ...over,
    }) as Record<string, unknown> & { id: bigint };
  };
  return { ...world, service, storage, files, events, actors, seedFile, access: accessService };
}

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException)
      return { status: error.getStatus(), body: error.getResponse() as { code?: string } };
    throw error;
  }
  return undefined;
};
const code = async (promise: Promise<unknown>) => (await failure(promise))?.body.code;
const snapshot = (files: FakeTable) =>
  JSON.stringify(files.rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

describe('ownership isolation: a normal user can only ever reach their own files', () => {
  it('lists only the signed-in user’s files, whatever the filters say', async () => {
    const { service, actors, seedFile } = await setup();
    seedFile(USER.alice, 'alice-1.pdf');
    seedFile(USER.alice, 'alice-2.pdf');
    seedFile(USER.bob, 'bob-secret.pdf');

    const mine = await service.list(actors.alice, defaultQuery);
    expect(mine.items.map((i) => i.name).sort()).toEqual(['alice-1.pdf', 'alice-2.pdf']);
    expect(mine.total).toBe(2);
    expect(mine.items.every((i) => i.ownerId === '2')).toBe(true);
    expect(mine.items[0]).not.toHaveProperty('owner'); // no other user's details for a normal user

    // Searching for somebody else's file name finds nothing; an owner filter in the query is ignored.
    expect((await service.list(actors.alice, { ...defaultQuery, search: 'bob-secret' })).items).toEqual([]);
    expect(
      (await service.list(actors.alice, { ...defaultQuery, ownerUserId: '3' })).items.map((i) => i.ownerId),
    ).toEqual(['2', '2']);
    expect((await service.list(actors.alice, { ...defaultQuery, type: 'pdf', search: 'bob' })).total).toBe(0);
  });

  it('pagination cannot walk into other users’ files', async () => {
    const { service, actors, seedFile } = await setup();
    for (let i = 0; i < 3; i++) seedFile(USER.alice, `a${i}.pdf`);
    for (let i = 0; i < 5; i++) seedFile(USER.bob, `b${i}.pdf`);
    const page2 = await service.list(actors.alice, { ...defaultQuery, page: 2, pageSize: 2 });
    expect(page2.total).toBe(3);
    expect(page2.items).toHaveLength(1);
    expect((await service.list(actors.alice, { ...defaultQuery, page: 9, pageSize: 2 })).items).toEqual([]);
  });

  describe("Alice against Bob's file", () => {
    const operations: [string, (ctx: Awaited<ReturnType<typeof setup>>, id: string) => Promise<unknown>][] = [
      ['get metadata', ({ service, actors }, id) => service.get(actors.alice, id)],
      ['download', ({ service, actors }, id) => service.download(actors.alice, id)],
      ['preview', ({ service, actors }, id) => service.preview(actors.alice, id)],
      ['rename', async ({ service, actors }, id) => service.rename(actors.alice, id, 'mine-now.pdf')],
      [
        'replace content',
        async ({ service, actors }, id) => service.replace(actors.alice, id, await incoming('x.pdf')),
      ],
      ['delete', ({ service, actors }, id) => service.remove(actors.alice, id)],
    ];

    it.each(operations)('%s: 404 FILE_NOT_FOUND, no OneDrive call, nothing changed', async (_name, run) => {
      const ctx = await setup();
      const bobs = ctx.seedFile(USER.bob, 'bob-private.pdf');
      const before = snapshot(ctx.files);

      const result = await failure(run(ctx, bobs.id.toString()));

      expect(result).toMatchObject({ status: 404, body: { code: 'FILE_NOT_FOUND' } });
      expect(ctx.storage.download).not.toHaveBeenCalled();
      expect(ctx.storage.replaceContent).not.toHaveBeenCalled();
      expect(ctx.storage.deleteItem).not.toHaveBeenCalled();
      expect(ctx.storage.getItem).not.toHaveBeenCalled();
      expect(snapshot(ctx.files)).toBe(before);
      expect(ctx.events.rows).toHaveLength(0);
    });

    it.each(operations)(
      '%s: the answer is IDENTICAL to a file that does not exist (no existence oracle)',
      async (_name, run) => {
        const ctx = await setup();
        const bobs = ctx.seedFile(USER.bob, 'bob-private.pdf');
        const notYours = await failure(run(ctx, bobs.id.toString()));
        const missing = await failure(run(ctx, '999999'));
        expect(notYours).toEqual(missing);
      },
    );
  });

  it.each([
    'abc',
    '',
    '-1',
    '1.5',
    '0x10',
    '1 OR 1=1',
    '1;DROP TABLE x',
    '9223372036854775808',
    '99999999999999999999',
  ])('a malformed file id %j is simply "not found"', async (raw) => {
    const { service, actors } = await setup();
    expect(await code(service.get(actors.alice, raw))).toBe('FILE_NOT_FOUND');
    expect(() => parseFileId(raw)).toThrow(HttpException);
  });

  it('files that are not ready (uploading, failed, deleted, deleting) are invisible even to their owner', async () => {
    const { service, actors, seedFile } = await setup();
    const uploading = seedFile(USER.alice, 'a.pdf', { upload_status: 'uploading' });
    const failed = seedFile(USER.alice, 'b.pdf', { upload_status: 'failed', is_deleted: true, deleted_at: new Date() });
    const deleted = seedFile(USER.alice, 'c.pdf', {
      upload_status: 'deleted',
      is_deleted: true,
      deleted_at: new Date(),
    });
    for (const row of [uploading, failed, deleted])
      expect(await code(service.get(actors.alice, row.id.toString()))).toBe('FILE_NOT_FOUND');
    expect((await service.list(actors.alice, defaultQuery)).total).toBe(0);
  });

  it('Alice cannot upload INTO Bob’s folder: the owner can never be chosen by a normal user', async () => {
    const { service, actors, storage, files } = await setup();
    const file = await incoming('sneaky.pdf');
    expect(await failure(service.upload(actors.alice, USER.bob, file))).toMatchObject({ status: 404 });
    expect(files.rows).toHaveLength(0);
    expect(storage.uploadNew).not.toHaveBeenCalled();
    expect(await exists(file.path)).toBe(false); // the temporary upload was removed anyway
  });

  it('a normal user cannot call the administrator-only operations', async () => {
    const { service, actors, seedFile } = await setup();
    const row = seedFile(USER.alice, 'mine.pdf');
    expect(await code(service.resync(actors.alice, row.id.toString()))).toBe('FILE_NOT_FOUND');
    expect(await code(service.usageByUser(actors.alice))).toBe('FILE_NOT_FOUND');
  });

  it('an actor that CLAIMS to be an administrator but is not in system_admins cannot write anything', async () => {
    const ctx = await setup();
    const row = ctx.seedFile(USER.bob, 'bob.pdf');
    const forged: Actor = { userId: USER.alice, isAdmin: true };
    const before = snapshot(ctx.files);
    expect(await code(ctx.service.rename(forged, row.id.toString(), 'x.pdf'))).toBe('SYSTEM_ADMIN_REQUIRED');
    expect(await code(ctx.service.remove(forged, row.id.toString()))).toBe('SYSTEM_ADMIN_REQUIRED');
    expect(await code(ctx.service.replace(forged, row.id.toString(), await incoming('x.pdf')))).toBe(
      'SYSTEM_ADMIN_REQUIRED',
    );
    expect(await code(ctx.service.upload(forged, USER.bob, await incoming('x.pdf')))).toBe('SYSTEM_ADMIN_REQUIRED');
    expect(snapshot(ctx.files)).toBe(before);
    expect(ctx.storage.deleteItem).not.toHaveBeenCalled();
  });

  it('an administrator using the NORMAL actor (My Files) sees only their own files', async () => {
    const ctx = await setup();
    ctx.seedFile(USER.admin, 'admin-own.pdf');
    ctx.seedFile(USER.alice, 'alice.pdf');
    const myFilesActor = await ctx.access.userActor(sessionUser(USER.admin));
    expect((await ctx.service.list(myFilesActor, defaultQuery)).items.map((i) => i.name)).toEqual(['admin-own.pdf']);
  });
});

describe('administrator access to every user’s files', () => {
  it('lists all users’ files with their owners, and can filter by owner, search and sort', async () => {
    const { service, actors, seedFile } = await setup();
    seedFile(USER.alice, 'zebra.pdf');
    seedFile(USER.bob, 'apple.pdf');
    seedFile(USER.bob, 'mango.txt');

    const all = await service.list(actors.admin, { ...defaultQuery, sort: 'name', order: 'asc' });
    expect(all.items.map((i) => i.name)).toEqual(['apple.pdf', 'mango.txt', 'zebra.pdf']);
    expect(all.items.map((i) => i.owner?.email)).toEqual(['bob@example.com', 'bob@example.com', 'alice@example.com']);

    expect((await service.list(actors.admin, { ...defaultQuery, ownerUserId: '3' })).total).toBe(2);
    expect((await service.list(actors.admin, { ...defaultQuery, search: 'ZEBRA' })).items.map((i) => i.name)).toEqual([
      'zebra.pdf',
    ]);
    expect((await service.list(actors.admin, { ...defaultQuery, type: 'pdf' })).total).toBe(2);
    expect((await service.list(actors.admin, { ...defaultQuery, sort: 'size', order: 'desc' })).items[0]?.name).toBe(
      'mango.txt',
    );
  });

  it('can get, download, preview, rename, replace and delete any user’s file', async () => {
    const ctx = await setup();
    const { service, actors, seedFile, storage, files } = ctx;
    const row = seedFile(USER.bob, 'bobs.pdf');
    const id = row.id.toString();

    expect((await service.get(actors.admin, id)).owner?.id).toBe('3');
    expect((await service.download(actors.admin, id)).filename).toBe('bobs.pdf');
    expect((await service.preview(actors.admin, id)).mimeType).toBe('application/pdf');
    expect((await service.rename(actors.admin, id, 'renamed.pdf')).name).toBe('renamed.pdf');
    expect((await service.replace(actors.admin, id, await incoming('new.pdf'))).contentVersion).toBe(2);
    await service.remove(actors.admin, id);

    expect(storage.deleteItem).toHaveBeenCalledWith('seed-item-1');
    expect(files.rows[0]).toMatchObject({ upload_status: 'deleted', is_deleted: true, deleted_by: USER.admin });
  });

  it('records every action on ANOTHER user’s file in the audit trail, with who, what and whose', async () => {
    const { service, actors, seedFile, events } = await setup();
    const row = seedFile(USER.bob, 'bobs.pdf');
    const id = row.id.toString();
    await service.download(actors.admin, id);
    await service.preview(actors.admin, id);
    await service.rename(actors.admin, id, 'r.pdf');
    await service.replace(actors.admin, id, await incoming('n.pdf'));
    await service.remove(actors.admin, id);

    expect(events.rows.map((e) => e['action'])).toEqual([
      'central_storage.file.download',
      'central_storage.file.preview',
      'central_storage.file.rename',
      'central_storage.file.replace',
      'central_storage.file.delete',
    ]);
    expect(events.rows[0]).toMatchObject({
      actor_user_id: USER.admin,
      actor_type: 'system_admin',
      entity_type_id: 10n,
      entity_id: row.id,
      request_id: 'req-1',
      ip_address: '127.0.0.1',
      new_values: { ownerUserId: '3' },
    });
    // Never file contents, names, tokens: only ids, sizes and codes.
    expect(JSON.stringify(events.rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toMatch(
      /bobs\.pdf|BYTES|token/i,
    );
  });

  it('writes the audit row BEFORE touching the file, and does nothing if it cannot be written (fail closed)', async () => {
    const { service, actors, seedFile, events, storage } = await setup();
    const row = seedFile(USER.bob, 'bobs.pdf');

    let auditedBeforeDownload = -1;
    storage.download.mockImplementationOnce(() => {
      auditedBeforeDownload = events.rows.length;
      return Promise.resolve(Readable.from([Buffer.from('x')]));
    });
    await service.download(actors.admin, row.id.toString());
    expect(auditedBeforeDownload).toBe(1);

    events.create = jest.fn().mockRejectedValue(new Error('audit table down'));
    storage.download.mockClear();
    storage.deleteItem.mockClear();
    await expect(service.download(actors.admin, row.id.toString())).rejects.toThrow('audit table down');
    await expect(service.remove(actors.admin, row.id.toString())).rejects.toThrow('audit table down');
    expect(storage.download).not.toHaveBeenCalled();
    expect(storage.deleteItem).not.toHaveBeenCalled();
    expect((await service.get(actors.admin, row.id.toString())).status).toBe('ready'); // still there, still visible
  });

  it('does not clutter the audit trail when an administrator handles their OWN file', async () => {
    const { service, actors, seedFile, events } = await setup();
    const row = seedFile(USER.admin, 'mine.pdf');
    await service.download(actors.admin, row.id.toString());
    await service.rename(actors.admin, row.id.toString(), 'm2.pdf');
    expect(events.rows).toHaveLength(0);
  });

  it('uploads a file FOR a selected user: owned by that user, uploaded by the administrator, audited', async () => {
    const { service, actors, storage, files, events } = await setup();
    const view = await service.upload(actors.admin, USER.bob, await incoming('for-bob.pdf'));

    expect(view).toMatchObject({ ownerId: '3', uploadedById: '1', name: 'for-bob.pdf' });
    expect(files.rows[0]).toMatchObject({ owner_user_id: USER.bob, uploaded_by: USER.admin });
    expect(storage.uploadNew.mock.calls[0]?.[0]).toBe(USER.bob); // Bob's folder
    expect(events.rows[0]).toMatchObject({
      action: 'central_storage.file.upload_for_user',
      new_values: expect.objectContaining({ ownerUserId: '3' }),
    });
  });

  it('refuses to upload for a user that does not exist or is deactivated, storing nothing', async () => {
    const { service, actors, storage, files } = await setup();
    for (const target of [USER.inactive, 4242n]) {
      const file = await incoming('x.pdf');
      expect(await failure(service.upload(actors.admin, target, file))).toMatchObject({
        status: 404,
        body: { code: 'USER_NOT_FOUND' },
      });
      expect(await exists(file.path)).toBe(false);
    }
    expect(files.rows).toHaveLength(0);
    expect(storage.uploadNew).not.toHaveBeenCalled();
  });

  it('privileges are rechecked for every write: revoking the grant stops an administrator mid-session', async () => {
    const ctx = await setup();
    const row = ctx.seedFile(USER.bob, 'bobs.pdf');
    await expect(ctx.service.rename(ctx.actors.admin, row.id.toString(), 'ok.pdf')).resolves.toBeDefined();

    (ctx.tables['system_admins']?.rows[0] as Record<string, unknown>)['is_active'] = false; // revoked
    const before = snapshot(ctx.files);
    expect(await code(ctx.service.rename(ctx.actors.admin, row.id.toString(), 'again.pdf'))).toBe(
      'SYSTEM_ADMIN_REQUIRED',
    );
    expect(await code(ctx.service.remove(ctx.actors.admin, row.id.toString()))).toBe('SYSTEM_ADMIN_REQUIRED');
    expect(await code(ctx.service.upload(ctx.actors.admin, USER.bob, await incoming('x.pdf')))).toBe(
      'SYSTEM_ADMIN_REQUIRED',
    );
    expect(await code(ctx.service.resync(ctx.actors.admin, row.id.toString()))).toBe('SYSTEM_ADMIN_REQUIRED');
    expect(snapshot(ctx.files)).toBe(before);
    expect(ctx.storage.deleteItem).not.toHaveBeenCalled();
  });

  it('reports total and per-user usage (only administrators)', async () => {
    const { service, actors, seedFile } = await setup();
    seedFile(USER.alice, 'a.pdf', { size_bytes: 100n });
    seedFile(USER.alice, 'b.pdf', { size_bytes: 50n });
    seedFile(USER.bob, 'c.pdf', { size_bytes: 1000n });
    seedFile(USER.bob, 'gone.pdf', {
      size_bytes: 9999n,
      upload_status: 'deleted',
      is_deleted: true,
      deleted_at: new Date(),
    });

    expect(await service.usage(actors.admin)).toEqual({ fileCount: 3, totalBytes: 1150 });
    const perUser = await service.usageByUser(actors.admin);
    expect(perUser.map((u) => [u.ownerId, u.fileCount, u.totalBytes]).sort()).toEqual([
      [2n, 2, 150],
      [3n, 1, 1000],
    ]);
    expect(await service.usage(actors.alice)).toEqual({ fileCount: 2, totalBytes: 150 });
  });
});

describe('upload', () => {
  it('stores a generated name in OneDrive, the original name only as the display name, and verifies the content', async () => {
    const { service, actors, storage, files } = await setup();
    const view = await service.upload(actors.alice, null, await incoming('Quarterly Report.pdf'));

    const row = files.rows[0] as Record<string, unknown>;
    expect(view).toMatchObject({
      name: 'Quarterly Report.pdf',
      mimeType: 'application/pdf',
      status: 'ready',
      previewable: true,
      ownerId: '2',
      uploadedById: '2',
    });
    expect(row['stored_name']).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.pdf$/);
    expect(storage.uploadNew.mock.calls[0]?.[1]).toBe(row['stored_name']); // the OneDrive item is named by the generated name
    expect(JSON.stringify(storage.uploadNew.mock.calls[0]?.[1])).not.toContain('Quarterly');
    expect(row['checksum_sha256']).toBe(createHash('sha256').update(PDF).digest('hex'));
    expect(row['external_item_id']).toBe('item-1');
    expect(row['uploaded_at']).toBeInstanceOf(Date);
  });

  it('duplicate original names are fine: each upload gets its own stored name and row', async () => {
    const { service, actors, files } = await setup();
    await service.upload(actors.alice, null, await incoming('same.pdf'));
    await service.upload(actors.alice, null, await incoming('same.pdf'));
    expect(files.rows).toHaveLength(2);
    expect(new Set(files.rows.map((r) => r['stored_name'])).size).toBe(2);
    expect((await service.list(actors.alice, defaultQuery)).total).toBe(2);
  });

  it('the MIME type comes from the bytes, never from the browser or the name', async () => {
    const { service, actors } = await setup();
    expect((await service.upload(actors.alice, null, await incoming('pic.png', PNG))).mimeType).toBe('image/png');
    expect(
      (await service.upload(actors.alice, null, await incoming('data.bin', Buffer.from('<script>x</script>'))))
        .previewable,
    ).toBe(false);
    expect(
      (await service.upload(actors.alice, null, await incoming('page.html', Buffer.from('<script>x</script>'))))
        .previewable,
    ).toBe(false);
  });

  it.each([
    ['an empty file', 'a.pdf', Buffer.alloc(0), 0, 'EMPTY_FILE', 400],
    ['a file over 50 MB', 'a.pdf', PDF, CENTRAL_MAX_FILE_BYTES + 1, 'FILE_TOO_LARGE', 413],
    ['a program', 'setup.exe', Buffer.from('MZ'), 2, 'FILE_TYPE_NOT_ALLOWED', 400],
    ['a script', 'run.ps1', Buffer.from('x'), 1, 'FILE_TYPE_NOT_ALLOWED', 400],
    ['a double extension trick', 'invoice.pdf.exe', PDF, PDF.length, 'FILE_TYPE_NOT_ALLOWED', 400],
    ['a PNG pretending to be a PDF', 'fake.pdf', PNG, PNG.length, 'FILE_CONTENT_MISMATCH', 400],
    ['a path-traversal name', '../../etc/passwd', Buffer.from('x'), 1, 'INVALID_PATH', 400],
    ['a reserved name', 'CON.txt', Buffer.from('x'), 1, 'INVALID_PATH', 400],
  ])(
    'rejects %s, stores nothing and cleans up the temporary file',
    async (_label, name, bytes, size, expectedCode, status) => {
      const { service, actors, storage, files } = await setup();
      const file = await incoming(name, bytes, size);
      expect(await failure(service.upload(actors.alice, null, file))).toMatchObject({
        status,
        body: { code: expectedCode },
      });
      expect(files.rows).toHaveLength(0);
      expect(storage.uploadNew).not.toHaveBeenCalled();
      expect(await exists(file.path)).toBe(false);
    },
  );

  it('always removes the temporary file, also after success', async () => {
    const { service, actors } = await setup();
    const file = await incoming('ok.pdf');
    await service.upload(actors.alice, null, file);
    expect(await exists(file.path)).toBe(false);
  });

  it('when OneDrive fails, the row is marked failed and hidden, and the error reaches the caller', async () => {
    const { service, actors, storage, files } = await setup();
    storage.uploadNew.mockRejectedValueOnce(
      new HttpException({ code: 'CENTRAL_STORAGE_QUOTA_EXCEEDED', message: 'full' }, 507),
    );
    expect(await failure(service.upload(actors.alice, null, await incoming('big.pdf')))).toMatchObject({
      status: 507,
      body: { code: 'CENTRAL_STORAGE_QUOTA_EXCEEDED' },
    });

    expect(files.rows[0]).toMatchObject({
      upload_status: 'failed',
      is_deleted: true,
      last_error_code: 'CENTRAL_STORAGE_QUOTA_EXCEEDED',
    });
    expect((await service.list(actors.alice, defaultQuery)).total).toBe(0);
  });

  it('when the metadata cannot be saved, the new OneDrive item is removed again and the user is told it was not saved', async () => {
    const { service, actors, storage, files } = await setup();
    // The final, conditional write of the row (the only updateMany in an upload) fails.
    const realUpdateMany = files.updateMany;
    files.updateMany = jest.fn().mockRejectedValueOnce(new Error('db down')).mockImplementation(realUpdateMany);

    expect(await failure(service.upload(actors.alice, null, await incoming('x.pdf')))).toMatchObject({
      status: 503,
      body: { code: 'METADATA_WRITE_FAILED' },
    });

    expect(storage.deleteItem).toHaveBeenCalledWith('item-1'); // compensated
    expect(files.rows[0]).toMatchObject({ upload_status: 'failed', is_deleted: true });
    expect((await service.list(actors.alice, defaultQuery)).total).toBe(0);
  });

  it('uploads from the same temporary file path are streamed from disk (the service never receives file bytes)', async () => {
    const { service, actors, storage } = await setup();
    const file = await incoming('streamed.pdf');
    await service.upload(actors.alice, null, file);
    expect(storage.uploadNew.mock.calls[0]?.[2]).toMatchObject({ path: file.path, size: PDF.length });
  });
});

describe('replace content', () => {
  it('replaces the content, keeps ownership and name, bumps the version and refreshes size and checksum', async () => {
    const { service, actors, seedFile, storage, files } = await setup();
    const row = seedFile(USER.alice, 'doc.pdf');
    const view = await service.replace(
      actors.alice,
      row.id.toString(),
      await incoming('whatever-name.pdf', Buffer.from('%PDF-1.4\nnew content here\n')),
    );

    expect(view).toMatchObject({ name: 'doc.pdf', contentVersion: 2, status: 'ready', ownerId: '2' });
    expect(storage.replaceContent).toHaveBeenCalledWith('seed-item-1', expect.anything(), undefined);
    expect(files.rows[0]).toMatchObject({ content_version: 2, external_etag: 'e2' });
    expect(files.rows[0]?.['checksum_sha256']).toBe(
      createHash('sha256').update('%PDF-1.4\nnew content here\n').digest('hex'),
    );
  });

  it('refuses content that does not match the file’s own type, and leaves everything as it was', async () => {
    const { service, actors, seedFile, storage, files } = await setup();
    const row = seedFile(USER.alice, 'doc.pdf');
    const before = snapshot(files);
    const file = await incoming('doc.pdf', PNG);
    expect(await code(service.replace(actors.alice, row.id.toString(), file))).toBe('FILE_CONTENT_MISMATCH');
    expect(storage.replaceContent).not.toHaveBeenCalled();
    expect(snapshot(files)).toBe(before);
    expect(await exists(file.path)).toBe(false);
  });

  it('one replacement at a time: a second one while the first is running is a 409', async () => {
    const { service, actors, seedFile, storage } = await setup();
    const row = seedFile(USER.alice, 'doc.pdf', { upload_status: 'replacing' });
    expect(await failure(service.replace(actors.alice, row.id.toString(), await incoming('d.pdf')))).toMatchObject({
      status: 409,
      body: { code: 'FILE_BUSY' },
    });
    expect(storage.replaceContent).not.toHaveBeenCalled();
  });

  it('an interrupted replacement (stuck "replacing" for 10+ minutes) can be started again', async () => {
    const { service, actors, seedFile, files } = await setup();
    const row = seedFile(USER.alice, 'doc.pdf', { upload_status: 'replacing' });
    (files.rows[0] as Record<string, unknown>)['updated_at'] = new Date(Date.now() - 11 * 60 * 1000);
    expect((await service.replace(actors.alice, row.id.toString(), await incoming('d.pdf'))).status).toBe('ready');
  });

  it('when OneDrive fails, the file is back to "ready" with its OLD size and checksum', async () => {
    const { service, actors, seedFile, storage, files } = await setup();
    const row = seedFile(USER.alice, 'doc.pdf', { checksum_sha256: 'old-checksum' });
    storage.replaceContent.mockRejectedValueOnce(new HttpException({ code: 'CENTRAL_STORAGE_UNAVAILABLE' }, 503));
    expect(await code(service.replace(actors.alice, row.id.toString(), await incoming('d.pdf')))).toBe(
      'CENTRAL_STORAGE_UNAVAILABLE',
    );
    expect(files.rows[0]).toMatchObject({
      upload_status: 'ready',
      checksum_sha256: 'old-checksum',
      content_version: 1,
      last_error_code: 'CENTRAL_STORAGE_UNAVAILABLE',
    });
  });

  it('when only the metadata fails, the file stays readable ("replacing"), says so, and an administrator can resync it', async () => {
    const { service, actors, seedFile, storage, files } = await setup();
    const row = seedFile(USER.alice, 'doc.pdf');
    // updateMany #1 claims the file, #2 is the final write of the new metadata: that one fails.
    const realUpdateMany = files.updateMany;
    files.updateMany = jest
      .fn()
      .mockImplementationOnce(realUpdateMany)
      .mockRejectedValueOnce(new Error('db down'))
      .mockImplementation(realUpdateMany);

    expect(await failure(service.replace(actors.alice, row.id.toString(), await incoming('d.pdf')))).toMatchObject({
      status: 503,
      body: { code: 'METADATA_WRITE_FAILED' },
    });
    expect(files.rows[0]).toMatchObject({ upload_status: 'replacing', last_error_code: 'METADATA_WRITE_FAILED' });
    // What the interrupted replacement was going to leave in OneDrive is on record, for recovery.
    expect(files.rows[0]?.['pending_size_bytes']).toBe(BigInt(PDF.length));
    expect((await service.get(actors.alice, row.id.toString())).status).toBe('replacing'); // still readable
    expect((await service.download(actors.alice, row.id.toString())).filename).toBe('doc.pdf');

    storage.getItem.mockResolvedValueOnce({
      id: 'seed-item-1',
      size: 4242,
      eTag: 'e9',
      cTag: 'c9',
      lastModifiedDateTime: '2026-11-05T13:00:00Z',
    });
    const repaired = await service.resync(actors.admin, row.id.toString());
    expect(repaired).toMatchObject({ status: 'ready', size: 4242 });
    expect(files.rows[0]?.['last_error_code']).toBeNull();
  });
});

describe('delete', () => {
  it('hides the file first, deletes it in OneDrive, then finalizes the row', async () => {
    const { service, actors, seedFile, storage, files } = await setup();
    const row = seedFile(USER.alice, 'doc.pdf');
    let stateWhenOneDriveWasCalled: Record<string, unknown> | undefined;
    storage.deleteItem.mockImplementationOnce(() => {
      stateWhenOneDriveWasCalled = { ...(files.rows[0] as Record<string, unknown>) };
      return Promise.resolve();
    });

    await service.remove(actors.alice, row.id.toString());

    expect(stateWhenOneDriveWasCalled).toMatchObject({
      upload_status: 'deleting',
      is_deleted: true,
      deleted_by: USER.alice,
    });
    expect(files.rows[0]).toMatchObject({ upload_status: 'deleted', is_deleted: true });
    expect(files.rows[0]?.['deleted_at']).toBeInstanceOf(Date); // satisfies the table's delete-consistency CHECK
    expect(await code(service.get(actors.alice, row.id.toString()))).toBe('FILE_NOT_FOUND');
  });

  it('when OneDrive refuses, the file is restored and visible again (never lost to everyone)', async () => {
    const { service, actors, seedFile, storage, files } = await setup();
    const row = seedFile(USER.alice, 'doc.pdf');
    storage.deleteItem.mockRejectedValueOnce(new HttpException({ code: 'CENTRAL_STORAGE_UNAVAILABLE' }, 503));

    expect(await code(service.remove(actors.alice, row.id.toString()))).toBe('CENTRAL_STORAGE_UNAVAILABLE');

    expect(files.rows[0]).toMatchObject({
      upload_status: 'ready',
      is_deleted: false,
      deleted_at: null,
      deleted_by: null,
    });
    expect((await service.get(actors.alice, row.id.toString())).name).toBe('doc.pdf');
  });

  it('a delete interrupted half way (row stuck "deleting") can be retried by an administrator, not by the user', async () => {
    const { service, actors, seedFile, storage, files } = await setup();
    const row = seedFile(USER.alice, 'doc.pdf', {
      upload_status: 'deleting',
      is_deleted: true,
      deleted_at: new Date(),
    });

    expect(await code(service.remove(actors.alice, row.id.toString()))).toBe('FILE_NOT_FOUND');
    expect(storage.deleteItem).not.toHaveBeenCalled();

    await service.remove(actors.admin, row.id.toString());
    expect(storage.deleteItem).toHaveBeenCalledWith('seed-item-1');
    expect(files.rows[0]).toMatchObject({ upload_status: 'deleted' });
  });

  it('does not touch OneDrive when the row cannot even be marked deleted', async () => {
    const { service, actors, seedFile, storage, files } = await setup();
    const row = seedFile(USER.alice, 'doc.pdf');
    files.updateMany = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(service.remove(actors.alice, row.id.toString())).rejects.toThrow('db down');
    expect(storage.deleteItem).not.toHaveBeenCalled();
    expect(files.rows[0]).toMatchObject({ upload_status: 'ready', is_deleted: false });
  });
});

describe('rename', () => {
  it('changes the display name only: OneDrive is never called, so it cannot be half done', async () => {
    const { service, actors, seedFile, storage, files } = await setup();
    const row = seedFile(USER.alice, 'old.pdf');
    const storedName = (files.rows[0] as Record<string, unknown>)['stored_name'];

    const view = await service.rename(actors.alice, row.id.toString(), 'New Name.PDF');

    expect(view.name).toBe('New Name.PDF');
    expect(files.rows[0]?.['stored_name']).toBe(storedName); // the OneDrive item keeps its generated name
    for (const fn of Object.values(storage))
      expect(fn).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('New Name'));
    expect(storage.replaceContent).not.toHaveBeenCalled();
    expect(storage.deleteItem).not.toHaveBeenCalled();
  });

  it.each([
    ['changing the extension', 'old.docx', 'EXTENSION_CHANGE_NOT_ALLOWED'],
    ['removing the extension', 'old', 'EXTENSION_CHANGE_NOT_ALLOWED'],
    ['a blocked type', 'old.exe', 'FILE_TYPE_NOT_ALLOWED'],
    ['a path', '../old.pdf', 'INVALID_PATH'],
    ['an empty name', '', 'INVALID_PATH'],
  ])('rejects %s and changes nothing', async (_label, name, expectedCode) => {
    const { service, actors, seedFile, files } = await setup();
    const row = seedFile(USER.alice, 'old.pdf');
    const before = snapshot(files);
    expect(await code(service.rename(actors.alice, row.id.toString(), name))).toBe(expectedCode);
    expect(snapshot(files)).toBe(before);
  });
});

describe('download and preview', () => {
  it('streams the file with its display name', async () => {
    const { service, actors, seedFile, storage } = await setup();
    const row = seedFile(USER.alice, 'doc.pdf');
    const result = await service.download(actors.alice, row.id.toString());
    expect(storage.download).toHaveBeenCalledWith('seed-item-1'); // the item id comes from PostgreSQL
    expect(result.filename).toBe('doc.pdf');
    expect(result.stream).toBeInstanceOf(Readable);
  });

  it('previews only types whose bytes were verified; everything else is a 415 without any OneDrive call', async () => {
    const { service, actors, seedFile, storage } = await setup();
    const html = seedFile(USER.alice, 'page.html', { mime_type: 'application/octet-stream' });
    const docx = seedFile(USER.alice, 'doc.docx', {
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    for (const row of [html, docx]) {
      expect(await failure(service.preview(actors.alice, row.id.toString()))).toMatchObject({
        status: 415,
        body: { code: 'PREVIEW_NOT_SUPPORTED' },
      });
    }
    expect(storage.download).not.toHaveBeenCalled();
    // ...but they can still be downloaded.
    await expect(service.download(actors.alice, html.id.toString())).resolves.toBeDefined();
  });

  it.each(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain'])(
    'previews %s',
    async (mime) => {
      const { service, actors, seedFile } = await setup();
      const row = seedFile(USER.alice, 'f.bin', { mime_type: mime });
      expect((await service.preview(actors.alice, row.id.toString())).mimeType).toBe(mime);
    },
  );
});

describe('usage', () => {
  it('counts only the user’s own ready files', async () => {
    const { service, actors, seedFile } = await setup();
    seedFile(USER.alice, 'a.pdf', { size_bytes: 10n });
    seedFile(USER.alice, 'b.pdf', { size_bytes: 20n, upload_status: 'replacing' });
    seedFile(USER.alice, 'c.pdf', { size_bytes: 40n, upload_status: 'uploading' });
    seedFile(USER.bob, 'd.pdf', { size_bytes: 80n });
    expect(await service.usage(actors.alice)).toEqual({ fileCount: 2, totalBytes: 30 });
    expect(await service.usage(actors.bob)).toEqual({ fileCount: 1, totalBytes: 80 });
  });

  it('is zero for a user with no files', async () => {
    const { service, actors } = await setup();
    expect(await service.usage(actors.alice)).toEqual({ fileCount: 0, totalBytes: 0 });
  });
});

describe('what recovery needs from an operation in flight', () => {
  const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const NEW = Buffer.from('%PDF-1.4\nthe replacement content\n');

  it('a replacement records, BEFORE it touches OneDrive, what it is going to leave there', async () => {
    const { service, actors, seedFile, storage, files } = await setup();
    const row = seedFile(USER.alice, 'doc.pdf');
    let seen: Record<string, unknown> | undefined;
    storage.replaceContent.mockImplementationOnce((itemId: string, file: { size: number }) => {
      seen = { ...files.rows[0] };
      return Promise.resolve({
        id: itemId,
        size: file.size,
        eTag: 'e2',
        cTag: 'c',
        createdDateTime: '2026-11-05T10:00:00Z',
        lastModifiedDateTime: '2026-11-05T10:00:00Z',
      });
    });

    await service.replace(actors.alice, row.id.toString(), await incoming('d.pdf', NEW));

    expect(seen).toMatchObject({
      upload_status: 'replacing',
      pending_size_bytes: BigInt(NEW.length),
      pending_checksum_sha256: sha(NEW),
    });
    expect(files.rows[0]).toMatchObject({
      upload_status: 'ready',
      pending_size_bytes: null,
      pending_checksum_sha256: null,
    });
  });

  it('a replacement that OneDrive refuses leaves no pending record behind', async () => {
    const { service, actors, seedFile, storage, files } = await setup();
    const row = seedFile(USER.alice, 'doc.pdf');
    storage.replaceContent.mockRejectedValueOnce(new HttpException({ code: 'CENTRAL_STORAGE_UNAVAILABLE' }, 503));
    await failure(service.replace(actors.alice, row.id.toString(), await incoming('d.pdf', NEW)));
    expect(files.rows[0]).toMatchObject({
      upload_status: 'ready',
      pending_size_bytes: null,
      pending_checksum_sha256: null,
    });
  });

  it('a new replacement starts with a clean recovery record', async () => {
    const { service, actors, seedFile, files } = await setup();
    const row = seedFile(USER.alice, 'doc.pdf', {
      recovery_attempts: 4,
      last_recovery_outcome: 'retry_scheduled',
      next_recovery_at: new Date(),
    });
    await service.replace(actors.alice, row.id.toString(), await incoming('d.pdf', NEW));
    expect(files.rows[0]).toMatchObject({
      recovery_attempts: 0,
      last_recovery_outcome: null,
      next_recovery_at: null,
      needs_review: false,
    });
  });

  it('an interrupted replacement cannot be retaken while the recovery worker holds the file, and can be once it has let go', async () => {
    const { service, actors, seedFile, files } = await setup();
    const stale = new Date(Date.now() - 20 * 60_000);
    const row = seedFile(USER.alice, 'doc.pdf', {
      upload_status: 'replacing',
      updated_at: stale,
      recovery_lease_token: '44444444-4444-4444-8444-444444444444',
      recovery_lease_until: new Date(Date.now() + 60_000),
    });
    expect(await failure(service.replace(actors.alice, row.id.toString(), await incoming('d.pdf', NEW)))).toMatchObject(
      {
        status: 409,
        body: { code: 'FILE_BUSY' },
      },
    );

    files.rows[0]['recovery_lease_token'] = null;
    files.rows[0]['recovery_lease_until'] = null;
    files.rows[0]['updated_at'] = stale;
    await expect(service.replace(actors.alice, row.id.toString(), await incoming('d.pdf', NEW))).resolves.toMatchObject(
      {
        status: 'ready',
      },
    );
  });

  it('an upload that finishes after recovery gave up on it removes its own item and reports the failure', async () => {
    const { service, actors, storage, files } = await setup();
    storage.uploadNew.mockImplementationOnce((_o: bigint, stored: string, file: { size: number }) => {
      files.rows[0]['upload_status'] = 'failed'; // the worker decided while this request was still running
      files.rows[0]['is_deleted'] = true;
      return Promise.resolve({
        id: 'late-item',
        name: stored,
        size: file.size,
        eTag: 'e1',
        cTag: 'c',
        createdDateTime: '2026-11-05T10:00:00Z',
        lastModifiedDateTime: '2026-11-05T10:00:00Z',
      });
    });
    expect(await failure(service.upload(actors.alice, null, await incoming('x.pdf')))).toMatchObject({
      status: 503,
      body: { code: 'METADATA_WRITE_FAILED' },
    });
    expect(storage.deleteItem).toHaveBeenCalledWith('late-item');
    expect(files.rows[0]).toMatchObject({ upload_status: 'failed' });
  });

  it('an upload that finds recovery already recorded ITS item succeeds and does NOT delete the item', async () => {
    const { service, actors, storage, files } = await setup();
    storage.uploadNew.mockImplementationOnce((_o: bigint, stored: string, file: { size: number }) => {
      Object.assign(files.rows[0], { upload_status: 'ready', external_item_id: 'item-same', external_etag: 'e1' });
      return Promise.resolve({
        id: 'item-same',
        name: stored,
        size: file.size,
        eTag: 'e1',
        cTag: 'c',
        createdDateTime: '2026-11-05T10:00:00Z',
        lastModifiedDateTime: '2026-11-05T10:00:00Z',
      });
    });
    await expect(service.upload(actors.alice, null, await incoming('x.pdf'))).resolves.toMatchObject({
      status: 'ready',
    });
    expect(storage.deleteItem).not.toHaveBeenCalled();
  });

  it('a replacement that finds recovery already recorded it succeeds', async () => {
    const { service, actors, seedFile, storage, files } = await setup();
    const row = seedFile(USER.alice, 'doc.pdf');
    storage.replaceContent.mockImplementationOnce((itemId: string, file: { size: number }) => {
      Object.assign(files.rows[0], { upload_status: 'ready', external_etag: 'e-new' });
      return Promise.resolve({
        id: itemId,
        size: file.size,
        eTag: 'e-new',
        cTag: 'c',
        createdDateTime: '2026-11-05T10:00:00Z',
        lastModifiedDateTime: '2026-11-05T10:00:00Z',
      });
    });
    await expect(service.replace(actors.alice, row.id.toString(), await incoming('d.pdf', NEW))).resolves.toMatchObject(
      {
        status: 'ready',
      },
    );
  });
});
