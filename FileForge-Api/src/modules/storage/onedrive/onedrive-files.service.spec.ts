import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { Logger, NotFoundException } from '@nestjs/common';

import type { SessionUser } from '../../../common/types/session.types';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { GraphClient } from '../../microsoft/graph/graph.client';
import { MicrosoftApiError, type MicrosoftErrorKind } from '../../microsoft/microsoft.errors';
import type { OneDriveConnectionService } from './onedrive-connection.service';
import { OneDriveFilesService, type StorageRequestContext } from './onedrive-files.service';
import { MAX_LIST_ITEMS, MAX_UPLOAD_BYTES } from './onedrive.constants';
import type { GraphDriveItem } from './onedrive.types';

const CONNECTION = { id: 5n, workspaceId: 1n, driveId: 'drive-1', rootItemId: 'root-1' };
const USER: SessionUser = { id: '7', email: 'owner@example.com', displayName: null };

function item(overrides: Partial<GraphDriveItem> = {}): GraphDriveItem {
  return {
    id: 'item-1',
    name: 'a.pdf',
    size: 10,
    eTag: 'etag-1',
    cTag: 'ctag-1',
    webUrl: 'https://onedrive.live.com/x',
    createdDateTime: '2026-11-04T10:00:00Z',
    lastModifiedDateTime: '2026-11-04T11:00:00Z',
    file: { mimeType: 'application/pdf' },
    parentReference: { driveId: 'drive-1', id: 'parent-1', path: '/drive/root:/FileForge' },
    ...overrides,
  };
}
const folder = (name: string) => item({ id: `f-${name}`, name, file: undefined, folder: { childCount: 0 } });
const failure = (kind: MicrosoftErrorKind, extra: { retryAfterSeconds?: number } = {}) =>
  new MicrosoftApiError(kind, extra);

function setup() {
  const calls: string[] = [];
  const graph = {
    request: jest.fn(),
    requestRaw: jest.fn(),
    // Same contract as GraphClient.pathFromLink: absolute Graph links only, returned as a path under the base.
    pathFromLink: jest.fn((link: string) => {
      const url = new URL(link);
      if (url.origin !== 'https://graph.microsoft.com') throw new Error('foreign link');
      return `${url.pathname.replace(/^\/v1\.0/, '')}${url.search}`;
    }),
  };
  const files = {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockImplementation(() => {
      calls.push('db.update');
      return Promise.resolve({});
    }),
  };
  const connections = { requireUsable: jest.fn().mockResolvedValue(CONNECTION) };
  const service = new OneDriveFilesService(
    { files } as unknown as PrismaService,
    graph as unknown as GraphClient,
    connections as unknown as OneDriveConnectionService,
  );
  const ctx: StorageRequestContext = { workspaceId: '1', user: USER, session: { homeAccountId: 'home-1', cookie: {} } };
  return { service, graph, files, connections, ctx, calls };
}

/** Graph answers by method + path prefix; records the order of calls. */
function routeGraph(graph: ReturnType<typeof setup>['graph'], calls: string[], routes: Record<string, unknown>) {
  graph.request.mockImplementation((_ctx: unknown, path: string, options?: { method?: string }) => {
    const key = `${options?.method ?? 'GET'} ${path.split('?')[0]}`;
    calls.push(`graph.${key}`);
    const handler = Object.entries(routes).find(([route]) => key === route || key.startsWith(route));
    const result = handler?.[1];
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve(typeof result === 'function' ? (result as () => unknown)() : result);
  });
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
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe('list', () => {
  it('builds the Graph path from the STORED drive and root ids plus the validated, encoded path', async () => {
    const { service, graph, ctx } = setup();
    graph.request.mockResolvedValue({ value: [] });

    await service.list(ctx, 'invoices/Q1 2026');

    expect(graph.request.mock.calls[0][1]).toMatch(
      /^\/drives\/drive-1\/items\/root-1:\/invoices\/Q1%202026:\/children\?\$top=200&\$select=/,
    );
  });

  it('lists the FileForge root when no path is given', async () => {
    const { service, graph, ctx } = setup();
    graph.request.mockResolvedValue({ value: [] });
    await service.list(ctx, undefined);
    expect(graph.request.mock.calls[0][1]).toMatch(/^\/drives\/drive-1\/items\/root-1\/children\?/);
  });

  it('returns folders first, then files by name, as browser paths with no Graph ids', async () => {
    const { service, graph, ctx } = setup();
    graph.request.mockResolvedValue({
      value: [item({ id: 'x1', name: 'b.pdf' }), folder('zeta'), item({ id: 'x2', name: 'a.pdf' }), folder('alpha')],
    });

    const result = await service.list(ctx, 'invoices');

    expect(result.items.map((i) => `${i.type}:${i.path}`)).toEqual([
      'folder:invoices/alpha',
      'folder:invoices/zeta',
      'file:invoices/a.pdf',
      'file:invoices/b.pdf',
    ]);
    expect(result.path).toBe('invoices');
    expect(JSON.stringify(result)).not.toMatch(/x1|x2|f-alpha|drive-1|root-1|parent-1|onedrive\.live\.com|etag/);
  });

  it('never lists shortcuts, notebooks, other-drive items or things that are neither file nor folder', async () => {
    const { service, graph, ctx } = setup();
    graph.request.mockResolvedValue({
      value: [
        item({ id: 'ok', name: 'ok.txt' }),
        item({ id: 's', name: 'shared-shortcut', remoteItem: { id: 'other' }, file: undefined, folder: {} }),
        item({ id: 'p', name: 'notebook', package: { type: 'oneNote' }, file: undefined, folder: {} }),
        item({ id: 'o', name: 'other-drive.txt', parentReference: { driveId: 'someone-elses-drive' } }),
        item({ id: 'n', name: 'neither', file: undefined }),
      ],
    });
    expect((await service.list(ctx, '')).items.map((i) => i.name)).toEqual(['ok.txt']);
  });

  it('follows next-page links through a validated path, and flags truncation at the cap', async () => {
    const { service, graph, ctx } = setup();
    const page = (count: number, start: number, next?: string) => ({
      value: Array.from({ length: count }, (_, i) => item({ id: `i${start + i}`, name: `f${start + i}.txt` })),
      '@odata.nextLink': next,
    });
    graph.request
      .mockResolvedValueOnce(
        page(600, 0, 'https://graph.microsoft.com/v1.0/drives/drive-1/items/root-1/children?$skiptoken=A'),
      )
      .mockResolvedValueOnce(
        page(600, 600, 'https://graph.microsoft.com/v1.0/drives/drive-1/items/root-1/children?$skiptoken=B'),
      );

    const result = await service.list(ctx, '');

    expect(result.items).toHaveLength(MAX_LIST_ITEMS);
    expect(result.truncated).toBe(true);
    expect(graph.pathFromLink).toHaveBeenCalledTimes(1);
    expect(graph.request.mock.calls[1][1]).toBe('/drives/drive-1/items/root-1/children?$skiptoken=A');
  });

  it('refuses a next-page link that points anywhere else', async () => {
    const { service, graph, ctx } = setup();
    graph.request.mockResolvedValue({ value: [], '@odata.nextLink': 'https://evil.example/steal' });
    await expect(service.list(ctx, '')).rejects.toThrow('foreign link');
    expect(graph.request).toHaveBeenCalledTimes(1);
  });

  it.each(['../other', 'a/../../b', '/abs', 'a\\b', 'a//b', 'x:y'])(
    'rejects the path "%s" before touching Graph',
    async (path) => {
      const { service, graph, connections, ctx } = setup();
      expect((await codeOf(service.list(ctx, path)))?.code).toBe('INVALID_PATH');
      expect(graph.request).not.toHaveBeenCalled();
      expect(connections.requireUsable).not.toHaveBeenCalled();
    },
  );
});

describe('upload', () => {
  const buffer = Buffer.from('%PDF-1.7 hello');
  const file = { name: 'new.pdf', buffer };

  function happy(over: { created?: GraphDriveItem } = {}) {
    const env = setup();
    routeGraph(env.graph, env.calls, {
      'GET /drives/drive-1/items/root-1:/invoices': folder('invoices'),
      'PUT /drives/drive-1/items/root-1:/invoices/new.pdf:/content':
        over.created ?? item({ id: 'new-1', name: 'new.pdf', size: buffer.length }),
      'DELETE /drives/drive-1/items/new-1': undefined,
    });
    return env;
  }

  it('checks the target folder, creates the file without ever overwriting, and records metadata', async () => {
    const { service, graph, files, ctx } = happy();

    const result = await service.upload(ctx, 'invoices', file);

    const put = graph.request.mock.calls.find((c) => c[2]?.method === 'PUT');
    expect(put?.[1]).toBe(
      '/drives/drive-1/items/root-1:/invoices/new.pdf:/content?@microsoft.graph.conflictBehavior=fail',
    );
    expect(Buffer.from(put?.[2].body).equals(buffer)).toBe(true);
    expect(files.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspace_id: 1n,
        connection_id: 5n,
        external_object_id: 'new-1',
        external_drive_id: 'drive-1',
        filename: 'new.pdf',
        storage_path: 'invoices/new.pdf',
        size_bytes: BigInt(buffer.length),
        checksum_sha256: createHash('sha256').update(buffer).digest('hex'),
        mime_type: 'application/pdf',
        upload_status: 'ready',
        uploaded_by: 7n,
        created_by: 7n,
      }),
    });
    expect(result).toMatchObject({ name: 'new.pdf', type: 'file', path: 'invoices/new.pdf' });
  });

  it('updates the existing metadata row for the same OneDrive item instead of adding a duplicate', async () => {
    const { service, files, ctx } = happy();
    files.findFirst.mockResolvedValue({ id: 99n });

    await service.upload(ctx, 'invoices', file);

    expect(files.create).not.toHaveBeenCalled();
    expect(files.update).toHaveBeenCalledWith({
      where: { id: 99n },
      data: expect.objectContaining({ filename: 'new.pdf' }),
    });
  });

  it('survives a concurrent request creating the same row (unique violation) by updating it', async () => {
    const { service, files, ctx } = happy();
    files.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 55n });
    files.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    await expect(service.upload(ctx, 'invoices', file)).resolves.toBeDefined();
    expect(files.update).toHaveBeenCalledWith({ where: { id: 55n }, data: expect.anything() });
  });

  it('scopes every metadata lookup to the workspace and connection', async () => {
    const { service, files, ctx } = happy();
    await service.upload(ctx, 'invoices', file);
    expect(files.findFirst).toHaveBeenCalledWith({
      where: { workspace_id: 1n, connection_id: 5n, external_object_id: 'new-1', is_deleted: false },
    });
  });

  it('reports an existing file name as a conflict and writes no metadata', async () => {
    const { service, graph, calls, files, ctx } = happy();
    routeGraph(graph, calls, {
      'GET /drives/drive-1/items/root-1:/invoices': folder('invoices'),
      'PUT ': failure('conflict'),
    });
    expect(await codeOf(service.upload(ctx, 'invoices', file))).toEqual({ code: 'FILE_ALREADY_EXISTS', status: 409 });
    expect(files.create).not.toHaveBeenCalled();
  });

  it('does not create folders: a missing target folder is a 404 and nothing is uploaded', async () => {
    const { service, graph, calls, ctx } = happy();
    routeGraph(graph, calls, { 'GET /drives/drive-1/items/root-1:/invoices': failure('not_found') });
    expect(await codeOf(service.upload(ctx, 'invoices', file))).toEqual({ code: 'ITEM_NOT_FOUND', status: 404 });
    expect(calls.some((c) => c.startsWith('graph.PUT'))).toBe(false);
  });

  it('refuses to upload into something that is not a folder', async () => {
    const { service, graph, calls, ctx } = happy();
    routeGraph(graph, calls, { 'GET /drives/drive-1/items/root-1:/invoices': item({ name: 'invoices' }) });
    expect((await codeOf(service.upload(ctx, 'invoices', file)))?.code).toBe('NOT_A_FOLDER');
  });

  it('rejects an item that did not land in the connection’s drive and records nothing', async () => {
    const { service, files, ctx } = happy({
      created: item({ id: 'new-1', name: 'new.pdf', parentReference: { driveId: 'another-drive', id: 'p' } }),
    });
    expect((await codeOf(service.upload(ctx, 'invoices', file)))?.code).toBe('ITEM_OUTSIDE_STORAGE_ROOT');
    expect(files.create).not.toHaveBeenCalled();
  });

  describe('validation (nothing reaches Graph or the database)', () => {
    const attempt = async (upload: { name: string; buffer: Buffer } | undefined, folderPath: unknown = 'invoices') => {
      const env = happy();
      const result = await codeOf(env.service.upload(env.ctx, folderPath, upload));
      expect(env.graph.request).not.toHaveBeenCalled();
      expect(env.files.create).not.toHaveBeenCalled();
      expect(env.connections.requireUsable).not.toHaveBeenCalled();
      return result?.code;
    };

    it('requires a file', async () => expect(await attempt(undefined)).toBe('FILE_REQUIRED'));
    it('rejects an empty file', async () =>
      expect(await attempt({ name: 'a.pdf', buffer: Buffer.alloc(0) })).toBe('EMPTY_FILE'));
    it('rejects a file over the size limit', async () =>
      expect(await attempt({ name: 'a.pdf', buffer: Buffer.alloc(MAX_UPLOAD_BYTES + 1) })).toBe('FILE_TOO_LARGE'));
    it('rejects executables', async () =>
      expect(await attempt({ name: 'setup.exe', buffer })).toBe('FILE_TYPE_NOT_ALLOWED'));
    it('rejects a disguised executable', async () =>
      expect(await attempt({ name: 'invoice.pdf.exe', buffer })).toBe('FILE_TYPE_NOT_ALLOWED'));
    it('rejects a name with a path separator', async () =>
      expect(await attempt({ name: '../x.pdf', buffer })).toBe('INVALID_PATH'));
    it('rejects a reserved name', async () => expect(await attempt({ name: 'con.pdf', buffer })).toBe('INVALID_PATH'));
    it('rejects a traversing target folder', async () =>
      expect(await attempt(file, '../../elsewhere')).toBe('INVALID_PATH'));
    it('rejects a non-text target folder', async () => expect(await attempt(file, ['a', 'b'])).toBe('INVALID_PATH'));
  });

  describe('metadata consistency', () => {
    it('removes the new file again when its metadata cannot be saved, and tells the user it was not saved', async () => {
      const { service, graph, files, ctx, calls } = happy();
      files.create.mockRejectedValue(new Error('database is down'));

      expect(await codeOf(service.upload(ctx, 'invoices', file))).toEqual({
        code: 'METADATA_WRITE_FAILED',
        status: 503,
      });

      // Compensation: exactly the item this request created, by its id, in the stored drive.
      const del = graph.request.mock.calls.find((c) => c[2]?.method === 'DELETE');
      expect(del?.[1]).toBe('/drives/drive-1/items/new-1');
      expect(calls.indexOf('graph.PUT /drives/drive-1/items/root-1:/invoices/new.pdf:/content')).toBeLessThan(
        calls.indexOf('graph.DELETE /drives/drive-1/items/new-1'),
      );
    });

    it('still reports the failure when the compensating delete fails too', async () => {
      const { service, graph, calls, files, ctx } = happy();
      files.create.mockRejectedValue(new Error('database is down'));
      routeGraph(graph, calls, {
        'GET /drives/drive-1/items/root-1:/invoices': folder('invoices'),
        'PUT ': item({ id: 'new-1', name: 'new.pdf' }),
        'DELETE ': failure('unavailable'),
      });
      expect((await codeOf(service.upload(ctx, 'invoices', file)))?.code).toBe('METADATA_WRITE_FAILED');
    });
  });
});

describe('download', () => {
  function stream(body: string) {
    return { body: Readable.toWeb(Readable.from([Buffer.from(body)])) };
  }

  it('streams the file through the API after checking it is a file in the stored drive', async () => {
    const { service, graph, calls, ctx } = setup();
    routeGraph(graph, calls, { 'GET /drives/drive-1/items/root-1:/invoices/a.pdf': item({ name: 'a.pdf' }) });
    graph.requestRaw.mockResolvedValue(stream('PDF-BYTES'));

    const result = await service.download(ctx, 'invoices/a.pdf');

    expect(graph.requestRaw.mock.calls[0][1]).toBe('/drives/drive-1/items/root-1:/invoices/a.pdf:/content');
    expect(result.filename).toBe('a.pdf');
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) chunks.push(Buffer.from(chunk as Buffer));
    expect(Buffer.concat(chunks).toString()).toBe('PDF-BYTES');
  });

  it('refuses folders, and anything outside the connection’s drive, without downloading', async () => {
    for (const [returned, expected] of [
      [folder('invoices'), 'NOT_A_FILE'],
      [item({ remoteItem: { id: 'x' } }), 'ITEM_OUTSIDE_STORAGE_ROOT'],
      [item({ parentReference: { driveId: 'another-drive' } }), 'ITEM_OUTSIDE_STORAGE_ROOT'],
      [item({ parentReference: undefined }), 'ITEM_OUTSIDE_STORAGE_ROOT'],
    ] as const) {
      const { service, graph, ctx } = setup();
      graph.request.mockResolvedValue(returned);
      expect((await codeOf(service.download(ctx, 'invoices/a.pdf')))?.code).toBe(expected);
      expect(graph.requestRaw).not.toHaveBeenCalled();
    }
  });

  it('answers 404 for a missing file and 502 for an empty response', async () => {
    const missing = setup();
    missing.graph.request.mockRejectedValue(failure('not_found'));
    expect(await codeOf(missing.service.download(missing.ctx, 'a.pdf'))).toEqual({
      code: 'ITEM_NOT_FOUND',
      status: 404,
    });

    const empty = setup();
    empty.graph.request.mockResolvedValue(item());
    empty.graph.requestRaw.mockResolvedValue({ body: null });
    expect(await codeOf(empty.service.download(empty.ctx, 'a.pdf'))).toEqual({ code: 'ONEDRIVE_ERROR', status: 502 });
  });

  it('requires a file path (the root is not downloadable)', async () => {
    const { service, graph, ctx } = setup();
    expect((await codeOf(service.download(ctx, '')))?.code).toBe('INVALID_PATH');
    expect(graph.request).not.toHaveBeenCalled();
  });
});

describe('rename', () => {
  function happy() {
    const env = setup();
    routeGraph(env.graph, env.calls, {
      'GET /drives/drive-1/items/root-1:/invoices/draft.pdf': item({ id: 'i-9', name: 'draft.pdf' }),
      'PATCH /drives/drive-1/items/i-9': item({ id: 'i-9', name: 'final.pdf' }),
    });
    return env;
  }

  it('renames by the resolved item id (never a browser-supplied id) and updates the metadata', async () => {
    const { service, graph, files, ctx } = happy();
    files.findFirst.mockResolvedValue({ id: 31n });

    const result = await service.rename(ctx, 'invoices/draft.pdf', 'final.pdf');

    const patch = graph.request.mock.calls.find((c) => c[2]?.method === 'PATCH');
    expect(patch?.[1]).toBe('/drives/drive-1/items/i-9');
    expect(JSON.parse(patch?.[2].body)).toEqual({ name: 'final.pdf', '@microsoft.graph.conflictBehavior': 'fail' });
    expect(files.update).toHaveBeenCalledWith({
      where: { id: 31n },
      data: expect.objectContaining({ filename: 'final.pdf', storage_path: 'invoices/final.pdf', updated_by: 7n }),
    });
    expect(result).toMatchObject({ name: 'final.pdf', path: 'invoices/final.pdf' });
  });

  it('creates the metadata row when the file had none (uploaded outside FileForge)', async () => {
    const { service, files, ctx } = happy();
    await service.rename(ctx, 'invoices/draft.pdf', 'final.pdf');
    expect(files.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ external_object_id: 'i-9', workspace_id: 1n }),
    });
  });

  it('puts the old name back when the metadata cannot be saved', async () => {
    const { service, graph, files, ctx } = happy();
    files.findFirst.mockResolvedValue({ id: 31n });
    files.update.mockRejectedValue(new Error('database is down'));

    expect(await codeOf(service.rename(ctx, 'invoices/draft.pdf', 'final.pdf'))).toEqual({
      code: 'METADATA_WRITE_FAILED',
      status: 503,
    });

    const patches = graph.request.mock.calls
      .filter((c) => c[2]?.method === 'PATCH')
      .map((c) => JSON.parse(c[2].body).name);
    expect(patches).toEqual(['final.pdf', 'draft.pdf']); // renamed, then reverted
  });

  it('reports a name clash as a conflict', async () => {
    const { service, graph, calls, ctx } = happy();
    routeGraph(graph, calls, {
      'GET /drives/drive-1/items/root-1:/invoices/draft.pdf': item({ id: 'i-9', name: 'draft.pdf' }),
      'PATCH ': failure('conflict'),
    });
    expect(await codeOf(service.rename(ctx, 'invoices/draft.pdf', 'taken.pdf'))).toEqual({
      code: 'FILE_ALREADY_EXISTS',
      status: 409,
    });
  });

  it.each([
    ['an executable name', 'run.exe'],
    ['a name with a separator', 'a/b.pdf'],
    ['a parent reference', '..'],
    ['a reserved name', 'nul'],
    ['a name with a control character', 'a\u0001.pdf'],
    ['an empty name', ''],
  ])('rejects %s without calling Graph', async (_label, newName) => {
    const { service, graph, ctx } = happy();
    expect(await codeOf(service.rename(ctx, 'invoices/draft.pdf', newName))).toBeDefined();
    expect(graph.request).not.toHaveBeenCalled();
  });

  it('refuses to rename a folder (folders are browse-only)', async () => {
    const { service, graph, calls, ctx } = happy();
    routeGraph(graph, calls, { 'GET /drives/drive-1/items/root-1:/invoices': folder('invoices') });
    expect((await codeOf(service.rename(ctx, 'invoices', 'x')))?.code).toBe('NOT_A_FILE');
    expect(calls.some((c) => c.startsWith('graph.PATCH'))).toBe(false);
  });
});

describe('delete', () => {
  function happy() {
    const env = setup();
    routeGraph(env.graph, env.calls, {
      'GET /drives/drive-1/items/root-1:/invoices/old.pdf': item({ id: 'i-3', name: 'old.pdf' }),
      'DELETE /drives/drive-1/items/i-3': undefined,
    });
    env.files.findFirst.mockResolvedValue({ id: 21n });
    return env;
  }

  it('soft-deletes the metadata FIRST (reversible), then deletes in OneDrive', async () => {
    const { service, files, ctx, calls } = happy();

    await service.delete(ctx, 'invoices/old.pdf');

    expect(files.update).toHaveBeenCalledWith({
      where: { id: 21n },
      data: {
        is_deleted: true,
        deleted_at: expect.any(Date),
        deleted_by: 7n,
        upload_status: 'deleted',
        updated_by: 7n,
      },
    });
    expect(calls.indexOf('db.update')).toBeGreaterThan(-1);
    expect(calls.indexOf('db.update')).toBeLessThan(calls.indexOf('graph.DELETE /drives/drive-1/items/i-3'));
  });

  it('keeps the soft-delete columns consistent with the database CHECK (deleted_at set whenever is_deleted)', async () => {
    const { service, files, ctx } = happy();
    await service.delete(ctx, 'invoices/old.pdf');
    const data = files.update.mock.calls[0][0].data;
    expect(data.is_deleted).toBe(true);
    expect(data.deleted_at).toBeInstanceOf(Date);
  });

  it('undoes the soft-delete when OneDrive refuses, and reports why', async () => {
    const { service, graph, calls, files, ctx } = happy();
    routeGraph(graph, calls, {
      'GET /drives/drive-1/items/root-1:/invoices/old.pdf': item({ id: 'i-3', name: 'old.pdf' }),
      'DELETE ': failure('throttled', { retryAfterSeconds: 9 }),
    });

    expect(await codeOf(service.delete(ctx, 'invoices/old.pdf'))).toEqual({ code: 'ONEDRIVE_THROTTLED', status: 429 });

    expect(files.update).toHaveBeenLastCalledWith({
      where: { id: 21n },
      data: { is_deleted: false, deleted_at: null, deleted_by: null, upload_status: 'ready', updated_by: 7n },
    });
  });

  it('does not touch OneDrive at all when the metadata cannot be marked deleted', async () => {
    const { service, files, ctx, calls } = happy();
    files.update.mockRejectedValue(new Error('database is down'));

    expect(await codeOf(service.delete(ctx, 'invoices/old.pdf'))).toEqual({
      code: 'METADATA_WRITE_FAILED',
      status: 503,
    });
    expect(calls.some((c) => c.startsWith('graph.DELETE'))).toBe(false);
  });

  it('treats a file that is already gone from OneDrive as deleted', async () => {
    const { service, graph, calls, files, ctx } = happy();
    routeGraph(graph, calls, {
      'GET /drives/drive-1/items/root-1:/invoices/old.pdf': item({ id: 'i-3', name: 'old.pdf' }),
      'DELETE ': failure('not_found'),
    });
    await expect(service.delete(ctx, 'invoices/old.pdf')).resolves.toBeUndefined();
    expect(files.update).toHaveBeenCalledTimes(1); // soft-delete stays, no undo
  });

  it('works for a file with no metadata row (OneDrive only)', async () => {
    const { service, files, ctx, calls } = happy();
    files.findFirst.mockResolvedValue(null);
    await service.delete(ctx, 'invoices/old.pdf');
    expect(files.update).not.toHaveBeenCalled();
    expect(calls).toContain('graph.DELETE /drives/drive-1/items/i-3');
  });

  it('only matches metadata of this workspace and connection', async () => {
    const { service, files, ctx } = happy();
    await service.delete(ctx, 'invoices/old.pdf');
    expect(files.findFirst).toHaveBeenCalledWith({
      where: { workspace_id: 1n, connection_id: 5n, external_object_id: 'i-3', is_deleted: false },
    });
  });

  it('never deletes folders, so the module folders cannot be removed through the app', async () => {
    const { service, graph, calls, files, ctx } = happy();
    routeGraph(graph, calls, { 'GET /drives/drive-1/items/root-1:/invoices': folder('invoices') });
    expect((await codeOf(service.delete(ctx, 'invoices')))?.code).toBe('NOT_A_FILE');
    expect(calls.some((c) => c.startsWith('graph.DELETE'))).toBe(false);
    expect(files.update).not.toHaveBeenCalled();
  });
});

describe('Microsoft failures and expired tokens', () => {
  const cases: [MicrosoftErrorKind, number, string][] = [
    ['reauth_required', 401, 'MICROSOFT_REAUTH_REQUIRED'],
    ['consent_required', 403, 'ONEDRIVE_CONSENT_REQUIRED'],
    ['forbidden', 403, 'ONEDRIVE_FORBIDDEN'],
    ['not_found', 404, 'ITEM_NOT_FOUND'],
    ['conflict', 409, 'FILE_ALREADY_EXISTS'],
    ['throttled', 429, 'ONEDRIVE_THROTTLED'],
    ['unavailable', 503, 'ONEDRIVE_UNAVAILABLE'],
    ['unknown', 502, 'ONEDRIVE_ERROR'],
  ];

  it.each(cases)('maps a %s failure to HTTP %i %s on every operation', async (kind, status, code) => {
    for (const run of [
      (e: ReturnType<typeof setup>) => e.service.list(e.ctx, ''),
      (e: ReturnType<typeof setup>) => e.service.download(e.ctx, 'a.pdf'),
      (e: ReturnType<typeof setup>) => e.service.rename(e.ctx, 'a.pdf', 'b.pdf'),
      (e: ReturnType<typeof setup>) => e.service.delete(e.ctx, 'a.pdf'),
      (e: ReturnType<typeof setup>) => e.service.upload(e.ctx, '', { name: 'a.pdf', buffer: Buffer.from('x') }),
    ]) {
      const env = setup();
      env.graph.request.mockRejectedValue(failure(kind));
      expect(await codeOf(run(env))).toEqual({ code, status });
    }
  });

  it('never forwards Graph details or tokens in the error', async () => {
    const env = setup();
    env.graph.request.mockRejectedValue(
      new MicrosoftApiError('forbidden', {
        status: 403,
        graphCode: 'accessDenied',
        cause: new Error('Bearer SECRET-TOKEN for user@example.com'),
      }),
    );
    const error = await env.service.list(env.ctx, '').catch((e: unknown) => e);
    expect(JSON.stringify((error as { response: unknown }).response)).not.toMatch(
      /SECRET-TOKEN|user@example\.com|accessDenied/,
    );
  });

  it('asks the user to sign in again when the session has no Microsoft account, before calling Graph', async () => {
    const env = setup();
    env.ctx.session.homeAccountId = undefined;
    expect(await codeOf(env.service.list(env.ctx, ''))).toEqual({ code: 'MICROSOFT_REAUTH_REQUIRED', status: 401 });
    expect(env.graph.request).not.toHaveBeenCalled();
  });
});

describe('workspace and connection isolation', () => {
  it('always resolves the connection through the caller’s workspace and user', async () => {
    const env = setup();
    env.graph.request.mockResolvedValue({ value: [] });
    await env.service.list({ ...env.ctx, workspaceId: '42', user: { ...USER, id: '9' } }, '');
    expect(env.connections.requireUsable).toHaveBeenCalledWith('42', expect.objectContaining({ id: '9' }));
  });

  it('stops when there is no usable connection, without any Graph call', async () => {
    const env = setup();
    env.connections.requireUsable.mockRejectedValue(new NotFoundException({ code: 'ONEDRIVE_NOT_CONNECTED' }));
    for (const run of [
      () => env.service.list(env.ctx, ''),
      () => env.service.download(env.ctx, 'a.pdf'),
      () => env.service.rename(env.ctx, 'a.pdf', 'b.pdf'),
      () => env.service.delete(env.ctx, 'a.pdf'),
      () => env.service.upload(env.ctx, '', { name: 'a.pdf', buffer: Buffer.from('x') }),
    ]) {
      expect((await codeOf(run()))?.code).toBe('ONEDRIVE_NOT_CONNECTED');
    }
    expect(env.graph.request).not.toHaveBeenCalled();
    expect(env.files.create).not.toHaveBeenCalled();
  });

  it('uses the drive and root from the connection, never from anything in the request', async () => {
    const env = setup();
    env.connections.requireUsable.mockResolvedValue({
      ...CONNECTION,
      driveId: 'stored-drive',
      rootItemId: 'stored-root',
    });
    env.graph.request.mockResolvedValue({ value: [] });
    await env.service.list(env.ctx, 'drive-1/items/root-1');
    expect(env.graph.request.mock.calls[0][1]).toMatch(
      /^\/drives\/stored-drive\/items\/stored-root:\/drive-1\/items\/root-1:\/children/,
    );
  });
});
