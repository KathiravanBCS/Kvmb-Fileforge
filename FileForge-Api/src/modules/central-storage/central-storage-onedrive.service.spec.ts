import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { HttpException, Logger } from '@nestjs/common';

import type { GraphClient } from '../microsoft/graph/graph.client';
import { MicrosoftApiError, type MicrosoftErrorKind } from '../microsoft/microsoft.errors';
import type { GraphDriveItem } from '../storage/onedrive/onedrive.types';
import { assertUploadUrl, CentralStorageOneDriveService } from './central-storage-onedrive.service';
import { UPLOAD_CHUNK_BYTES } from './central-storage.constants';
import type { CentralTokenVault } from './central-token-vault.service';

const CONNECTION = { id: 1n, driveId: 'drive-1', rootItemId: 'root-1', usersFolderItemId: 'users-1', ownerUserId: 1n };
const UPLOAD_URL = 'https://upload.example.com/session/abc123';
const MIB = 1024 * 1024;

let dir: string;
let fetchMock: jest.SpyInstance;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'central-graph-'));
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  jest.restoreAllMocks();
});
afterEach(() => fetchMock?.mockRestore());

let counter = 0;
async function tempFile(size: number): Promise<{ path: string; size: number }> {
  const path = join(dir, `f${counter++}`);
  await writeFile(path, Buffer.alloc(size, 7));
  return { path, size };
}

const folder = (id: string, name = id): GraphDriveItem => ({
  id,
  name,
  folder: { childCount: 0 },
  parentReference: { driveId: 'drive-1' },
});
const fileItem = (over: Partial<GraphDriveItem> = {}): GraphDriveItem => ({
  id: 'item-new',
  name: 'x.pdf',
  size: 10,
  file: { mimeType: 'application/pdf' },
  parentReference: { driveId: 'drive-1', path: '/drive/root:/FileForge-Central/users/2' },
  ...over,
});
const failure = (
  kind: MicrosoftErrorKind,
  extra: { status?: number; graphCode?: string; retryAfterSeconds?: number } = {},
) => new MicrosoftApiError(kind, extra);

function setup() {
  const graph = { request: jest.fn(), requestRaw: jest.fn() };
  const graphContext = { cache: { load: () => undefined, save: () => undefined }, homeAccountId: 'home-1' };
  const vault = {
    usableConnection: jest.fn().mockResolvedValue(CONNECTION),
    withGraph: jest.fn((fn: (c: unknown) => unknown) => fn({ graph: graphContext, connection: CONNECTION })),
  };
  const service = new CentralStorageOneDriveService(
    vault as unknown as CentralTokenVault,
    graph as unknown as GraphClient,
  );
  service.wait = jest.fn().mockResolvedValue(undefined);
  return { service, graph, vault, graphContext };
}

/** Graph answers by "METHOD path" (query string ignored, first prefix match); records the calls. */
function route(graph: ReturnType<typeof setup>['graph'], routes: Record<string, unknown>) {
  const calls: string[] = [];
  graph.request.mockImplementation((_ctx: unknown, path: string, options?: { method?: string }) => {
    const key = `${options?.method ?? 'GET'} ${path.split('?')[0]}`;
    calls.push(key);
    const entry = Object.entries(routes).find(([prefix]) => key === prefix || key.startsWith(prefix));
    const value = entry?.[1];
    if (entry === undefined) return Promise.reject(failure('not_found'));
    const result = typeof value === 'function' ? (value as () => unknown)() : value;
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  });
  return calls;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyLength: number;
}
function mockFetch(handler: (call: FetchCall, index: number) => Response | Promise<Response>): FetchCall[] {
  const calls: FetchCall[] = [];
  fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const body = init?.body as Uint8Array | undefined;
    const call: FetchCall = {
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      method: String(init?.method ?? 'GET'),
      headers: { ...((init?.headers as Record<string, string>) ?? {}) },
      bodyLength: body ? body.byteLength : 0,
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  });
  return calls;
}

const caught = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException)
      return { status: error.getStatus(), code: (error.getResponse() as { code?: string }).code };
    return { error };
  }
  return undefined;
};

describe('uploading a new file', () => {
  it('puts small files into users/<ownerId>/<generatedName> with conflictBehavior=fail (never overwrites)', async () => {
    const { service, graph } = setup();
    const calls = route(graph, {
      'GET /drives/drive-1/items/users-1:/2': folder('user-2-folder', '2'),
      'PUT /drives/drive-1/items/user-2-folder:/abc.pdf:/content': fileItem(),
    });
    const item = await service.uploadNew(2n, 'abc.pdf', await tempFile(1000));

    expect(item.id).toBe('item-new');
    expect(calls).toEqual([
      'GET /drives/drive-1/items/users-1:/2',
      'PUT /drives/drive-1/items/user-2-folder:/abc.pdf:/content',
    ]);
    const put = graph.request.mock.calls.find((c) => c[2]?.method === 'PUT');
    expect(put?.[1]).toContain('@microsoft.graph.conflictBehavior=fail');
    expect(put?.[2].scopes).toEqual(['Files.ReadWrite']);
  });

  it('creates the user’s folder the first time (named by the database id, never an e-mail) and adopts it afterwards', async () => {
    const { service, graph } = setup();
    let created = false;
    const calls = route(graph, {
      'GET /drives/drive-1/items/users-1:/3': () => (created ? folder('f3', '3') : failure('not_found')),
      'POST /drives/drive-1/items/users-1/children': () => {
        created = true;
        return folder('f3', '3');
      },
      'PUT /drives/drive-1/items/f3:/n.pdf:/content': fileItem({ id: 'i3' }),
    });
    await service.uploadNew(3n, 'n.pdf', await tempFile(10));
    const post = graph.request.mock.calls.find((c) => c[2]?.method === 'POST');
    expect(JSON.parse(post?.[2].body)).toMatchObject({
      name: '3',
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    });
    expect(calls.filter((c) => c.startsWith('POST'))).toHaveLength(1);
  });

  it('remembers the folder, and recovers once if it was removed in OneDrive meanwhile', async () => {
    const { service, graph } = setup();
    let putAttempts = 0;
    route(graph, {
      'GET /drives/drive-1/items/users-1:/2': folder('old-folder', '2'),
      'PUT /drives/drive-1/items/old-folder:/a.pdf:/content': fileItem(),
      'PUT /drives/drive-1/items/old-folder:/b.pdf:/content': () => {
        putAttempts++;
        return failure('not_found');
      },
    });
    await service.uploadNew(2n, 'a.pdf', await tempFile(10)); // resolves + caches the folder
    graph.request.mockClear();

    // The folder is gone: the cached id fails, a fresh one is resolved, and the upload is retried ONCE.
    route(graph, {
      'GET /drives/drive-1/items/users-1:/2': folder('new-folder', '2'),
      'PUT /drives/drive-1/items/old-folder:/b.pdf:/content': failure('not_found'),
      'PUT /drives/drive-1/items/new-folder:/b.pdf:/content': fileItem({ id: 'b' }),
    });
    expect((await service.uploadNew(2n, 'b.pdf', await tempFile(10))).id).toBe('b');
    expect(putAttempts).toBe(0);
  });

  it('does NOT retry creating an item on a server error (the file might already exist)', async () => {
    const { service, graph } = setup();
    route(graph, {
      'GET /drives/drive-1/items/users-1:/2': folder('f2', '2'),
      'PUT /drives/drive-1/items/f2:/a.pdf:/content': failure('unavailable', { status: 503 }),
    });
    expect(await caught(service.uploadNew(2n, 'a.pdf', await tempFile(10)))).toEqual({
      status: 503,
      code: 'CENTRAL_STORAGE_UNAVAILABLE',
    });
    expect(graph.request.mock.calls.filter((c) => c[2]?.method === 'PUT')).toHaveLength(1);
  });

  it('refuses an item that Graph reports outside FileForge-Central or in another drive', async () => {
    const { service, graph } = setup();
    route(graph, {
      'GET /drives/drive-1/items/users-1:/2': folder('f2', '2'),
      'PUT /drives/drive-1/items/f2:/a.pdf:/content': fileItem({
        parentReference: { driveId: 'drive-1', path: '/drive/root:/FileForge/invoices' },
      }),
    });
    expect(await caught(service.uploadNew(2n, 'a.pdf', await tempFile(10)))).toMatchObject({ status: 502 });

    route(graph, {
      'GET /drives/drive-1/items/users-1:/2': folder('f2', '2'),
      'PUT /drives/drive-1/items/f2:/a.pdf:/content': fileItem({ parentReference: { driveId: 'other-drive' } }),
    });
    expect(await caught(service.uploadNew(2n, 'a.pdf', await tempFile(10)))).toMatchObject({ status: 502 });
  });

  it('a lost Microsoft authorization is reported as 503 RECONNECT_REQUIRED, never 401 (that would sign the user out)', async () => {
    const { service, graph } = setup();
    route(graph, { 'GET /drives/drive-1/items/users-1:/2': failure('reauth_required') });
    expect(await caught(service.uploadNew(2n, 'a.pdf', await tempFile(10)))).toEqual({
      status: 503,
      code: 'CENTRAL_STORAGE_RECONNECT_REQUIRED',
    });
    route(graph, { 'GET /drives/drive-1/items/users-1:/2': failure('consent_required') });
    expect(await caught(service.uploadNew(2n, 'a.pdf', await tempFile(10)))).toEqual({
      status: 503,
      code: 'CENTRAL_STORAGE_RECONNECT_REQUIRED',
    });
  });
});

describe('large uploads (Graph upload session)', () => {
  const SIZE = 11 * MIB; // 3 chunks of 5 MiB, 5 MiB, 1 MiB

  function sessionRoutes(graph: ReturnType<typeof setup>['graph']) {
    return route(graph, {
      'GET /drives/drive-1/items/users-1:/2': folder('f2', '2'),
      'POST /drives/drive-1/items/f2:/big.bin:/createUploadSession': { uploadUrl: UPLOAD_URL },
    });
  }

  it('sends bounded chunks in order, with the right ranges, and WITHOUT the access token', async () => {
    const { service, graph } = setup();
    sessionRoutes(graph);
    const calls = mockFetch((_call, index) => {
      if (index === 0) return json(202, { nextExpectedRanges: [`${UPLOAD_CHUNK_BYTES}-`] });
      if (index === 1) return json(202, { nextExpectedRanges: [`${2 * UPLOAD_CHUNK_BYTES}-`] });
      return json(201, fileItem({ id: 'big' }));
    });

    const item = await service.uploadNew(2n, 'big.bin', await tempFile(SIZE));

    expect(item.id).toBe('big');
    expect(calls.map((c) => c.headers['Content-Range'])).toEqual([
      `bytes 0-${UPLOAD_CHUNK_BYTES - 1}/${SIZE}`,
      `bytes ${UPLOAD_CHUNK_BYTES}-${2 * UPLOAD_CHUNK_BYTES - 1}/${SIZE}`,
      `bytes ${2 * UPLOAD_CHUNK_BYTES}-${SIZE - 1}/${SIZE}`,
    ]);
    expect(Math.max(...calls.map((c) => c.bodyLength))).toBe(UPLOAD_CHUNK_BYTES); // memory is bounded by one chunk
    expect(UPLOAD_CHUNK_BYTES % (320 * 1024)).toBe(0); // Graph requires a multiple of 320 KiB
    for (const call of calls) {
      expect(call.url).toBe(UPLOAD_URL);
      expect(call.method).toBe('PUT');
      expect(Object.keys(call.headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    }
    const session = graph.request.mock.calls.find((c) => String(c[1]).endsWith('createUploadSession'));
    expect(JSON.parse(session?.[2].body)).toEqual({ item: { '@microsoft.graph.conflictBehavior': 'fail' } });
  });

  it('after a transient error it asks the session where it stands and resumes (bounded retries)', async () => {
    const { service, graph } = setup();
    sessionRoutes(graph);
    const calls = mockFetch((call, index) => {
      if (index === 0) return json(202, { nextExpectedRanges: [`${UPLOAD_CHUNK_BYTES}-`] });
      if (index === 1) return json(503, { error: { code: 'serviceNotAvailable' } }); // chunk 2 fails
      if (call.method === 'GET') return json(200, { nextExpectedRanges: [`${UPLOAD_CHUNK_BYTES}-`] }); // status query
      if (index === 3) return json(202, { nextExpectedRanges: [`${2 * UPLOAD_CHUNK_BYTES}-`] });
      return json(201, fileItem({ id: 'big' }));
    });
    await service.uploadNew(2n, 'big.bin', await tempFile(SIZE));
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'PUT', 'GET', 'PUT', 'PUT']);
    expect(service.wait).toHaveBeenCalledTimes(1);
  });

  it('gives up after repeated failures, cancels the session, and does not loop forever', async () => {
    const { service, graph } = setup();
    sessionRoutes(graph);
    const calls = mockFetch((call) => (call.method === 'DELETE' ? json(204, {}) : json(503, {})));
    expect(await caught(service.uploadNew(2n, 'big.bin', await tempFile(SIZE)))).toMatchObject({
      status: 503,
      code: 'CENTRAL_STORAGE_UNAVAILABLE',
    });
    expect(calls.filter((c) => c.method === 'PUT').length).toBeLessThanOrEqual(3);
    expect(calls.at(-1)?.method).toBe('DELETE'); // nothing is left behind on the OneDrive side
  });

  it('reports a full OneDrive (507 / quotaLimitReached) clearly, without retrying, and cancels the session', async () => {
    const { service, graph } = setup();
    sessionRoutes(graph);
    const calls = mockFetch((call) =>
      call.method === 'DELETE' ? json(204, {}) : json(507, { error: { code: 'quotaLimitReached' } }),
    );
    expect(await caught(service.uploadNew(2n, 'big.bin', await tempFile(SIZE)))).toEqual({
      status: 507,
      code: 'CENTRAL_STORAGE_QUOTA_EXCEEDED',
    });
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'DELETE']);
    expect(service.wait).not.toHaveBeenCalled();
  });

  it('also recognises a quota error that arrives as a different status', async () => {
    const { service, graph } = setup();
    sessionRoutes(graph);
    mockFetch((call) =>
      call.method === 'DELETE' ? json(204, {}) : json(409, { error: { code: 'quotaLimitReached' } }),
    );
    expect(await caught(service.uploadNew(2n, 'big.bin', await tempFile(SIZE)))).toEqual({
      status: 507,
      code: 'CENTRAL_STORAGE_QUOTA_EXCEEDED',
    });
  });

  it('stops when the browser cancels, sends no further chunks, and cancels the session', async () => {
    const { service, graph } = setup();
    sessionRoutes(graph);
    const controller = new AbortController();
    const calls = mockFetch((call, index) => {
      if (call.method === 'DELETE') return json(204, {});
      if (index === 0) {
        controller.abort(); // the user closed the tab after the first chunk
        return json(202, { nextExpectedRanges: [`${UPLOAD_CHUNK_BYTES}-`] });
      }
      throw new Error('no chunk may be sent after cancelling');
    });
    expect(await caught(service.uploadNew(2n, 'big.bin', await tempFile(SIZE), controller.signal))).toEqual({
      status: 400,
      code: 'UPLOAD_CANCELLED',
    });
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'DELETE']);
  });

  it('fails (and cancels) when the session never answers sensibly, instead of looping', async () => {
    const { service, graph } = setup();
    sessionRoutes(graph);
    const calls = mockFetch((call) =>
      call.method === 'DELETE' ? json(204, {}) : json(202, { nextExpectedRanges: ['0-'] }),
    );
    await caught(service.uploadNew(2n, 'big.bin', await tempFile(SIZE)));
    expect(calls.filter((c) => c.method === 'PUT').length).toBeLessThan(12);
    expect(calls.at(-1)?.method).toBe('DELETE');
  });

  it.each([
    'http://upload.example.com/x',
    'https://127.0.0.1/x',
    'https://localhost/x',
    'https://[::1]/x',
    'https://user:pw@upload.example.com/x',
    'not a url',
  ])('refuses an upload URL that is not a plain https host: %s', (url) =>
    expect(() => assertUploadUrl(url)).toThrow(MicrosoftApiError),
  );
  it('accepts a normal https upload URL', () => expect(() => assertUploadUrl(UPLOAD_URL)).not.toThrow());
});

describe('replacing content', () => {
  it('small files: one request that replaces the item content (same item id, so ownership and links stay)', async () => {
    const { service, graph } = setup();
    const calls = route(graph, { 'PUT /drives/drive-1/items/item-9/content': fileItem({ id: 'item-9' }) });
    expect((await service.replaceContent('item-9', await tempFile(100))).id).toBe('item-9');
    expect(calls).toEqual(['PUT /drives/drive-1/items/item-9/content']);
  });

  it('large files: an upload session on the existing item with conflictBehavior=replace', async () => {
    const { service, graph } = setup();
    route(graph, { 'POST /drives/drive-1/items/item-9/createUploadSession': { uploadUrl: UPLOAD_URL } });
    mockFetch((_c, index) =>
      index === 0
        ? json(202, { nextExpectedRanges: [`${UPLOAD_CHUNK_BYTES}-`] })
        : json(200, fileItem({ id: 'item-9' })),
    );
    await service.replaceContent('item-9', await tempFile(6 * MIB));
    const session = graph.request.mock.calls[0];
    expect(JSON.parse(session?.[2].body)).toEqual({ item: { '@microsoft.graph.conflictBehavior': 'replace' } });
  });
});

describe('downloading, deleting, inspecting', () => {
  it('streams the item content, retrying throttling with the server’s wait time (capped)', async () => {
    const { service, graph } = setup();
    graph.requestRaw
      .mockRejectedValueOnce(failure('throttled', { retryAfterSeconds: 3 }))
      .mockRejectedValueOnce(failure('throttled', { retryAfterSeconds: 999 }))
      .mockResolvedValueOnce(new Response(Readable.toWeb(Readable.from([Buffer.from('FILE')])) as never));
    const stream = await service.download('item-1');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);

    expect(Buffer.concat(chunks).toString()).toBe('FILE');
    expect(graph.requestRaw.mock.calls[0]?.[1]).toBe('/drives/drive-1/items/item-1/content');
    expect(service.wait).toHaveBeenNthCalledWith(1, 3000);
    expect(service.wait).toHaveBeenNthCalledWith(2, 10_000); // capped
  });

  it('gives up after 3 attempts on a persistent server error', async () => {
    const { service, graph } = setup();
    graph.requestRaw.mockRejectedValue(failure('unavailable', { status: 503 }));
    expect(await caught(service.download('item-1'))).toEqual({ status: 503, code: 'CENTRAL_STORAGE_UNAVAILABLE' });
    expect(graph.requestRaw).toHaveBeenCalledTimes(3);
  });

  it('a missing item is "not found", not a server error, and is not retried', async () => {
    const { service, graph } = setup();
    graph.requestRaw.mockRejectedValue(failure('not_found'));
    expect(await caught(service.download('item-1'))).toEqual({ status: 404, code: 'FILE_NOT_FOUND' });
    expect(graph.requestRaw).toHaveBeenCalledTimes(1);
  });

  it('delete: already gone counts as deleted; other failures are retried then reported', async () => {
    const { service, graph } = setup();
    route(graph, { 'DELETE /drives/drive-1/items/gone': failure('not_found') });
    await expect(service.deleteItem('gone')).resolves.toBeUndefined();

    graph.request.mockReset().mockRejectedValue(failure('unavailable', { status: 503 }));
    expect(await caught(service.deleteItem('x'))).toEqual({ status: 503, code: 'CENTRAL_STORAGE_UNAVAILABLE' });
    expect(graph.request).toHaveBeenCalledTimes(3);
  });

  it('getItem refuses anything Graph places outside FileForge-Central', async () => {
    const { service, graph } = setup();
    route(graph, { 'GET /drives/drive-1/items/inside': fileItem({ id: 'inside' }) });
    await expect(service.getItem('inside')).resolves.toMatchObject({ id: 'inside' });

    for (const path of ['/drive/root:/FileForge/a', '/drive/root:/Documents', '/drive/root:']) {
      route(graph, {
        'GET /drives/drive-1/items/bad': fileItem({ id: 'bad', parentReference: { driveId: 'drive-1', path } }),
      });
      expect(await caught(service.getItem('bad'))).toMatchObject({ status: 502 });
    }
  });

  it('health reads the quota and checks that the central root still exists', async () => {
    const { service, graph } = setup();
    route(graph, {
      'GET /drives/drive-1/items/root-1': folder('root-1', 'FileForge-Central'),
      'GET /drives/drive-1': { quota: { total: 5_000, used: 1_000, remaining: 4_000, state: 'normal' } },
    });
    expect(await service.health()).toEqual({ total: 5000, used: 1000, remaining: 4000, state: 'normal' });

    route(graph, {
      'GET /drives/drive-1/items/root-1': { id: 'root-1', name: 'FileForge-Central' }, // now a FILE, or gone
      'GET /drives/drive-1': { quota: {} },
    });
    expect(await caught(service.health())).toMatchObject({ status: 404 });
  });

  it('every call is scoped to the stored drive; it never touches /me/drive or the personal FileForge folder', async () => {
    const { service, graph } = setup();
    const calls = route(graph, {
      'GET /drives/drive-1/items/users-1:/2': folder('f2', '2'),
      'PUT /drives/drive-1/items/f2:/a.pdf:/content': fileItem(),
      'DELETE /drives/drive-1/items/i': undefined,
    });
    await service.uploadNew(2n, 'a.pdf', await tempFile(10));
    await service.deleteItem('i');
    for (const call of calls) {
      expect(call).toMatch(/ \/drives\/drive-1\/items\//);
      expect(call).not.toMatch(/\/me\/drive|root:\/FileForge[^-]/);
    }
  });
});

describe('creating the central layout', () => {
  const ctx = { cache: { load: () => undefined, save: () => undefined }, homeAccountId: 'h' };
  const inDrive9 = (id: string, name: string): GraphDriveItem => ({
    ...folder(id, name),
    parentReference: { driveId: 'drive-9' },
  });

  it('creates FileForge-Central and FileForge-Central/users, and nothing else', async () => {
    const { service, graph } = setup();
    const made: string[] = [];
    const calls = route(graph, {
      'GET /me/drive': { id: 'drive-9' },
      'GET /drives/drive-9/root:/FileForge-Central': failure('not_found'),
      'POST /drives/drive-9/root/children': () => {
        made.push('root');
        return inDrive9('root-9', 'FileForge-Central');
      },
      'GET /drives/drive-9/items/root-9:/users': failure('not_found'),
      'POST /drives/drive-9/items/root-9/children': () => {
        made.push('users');
        return inDrive9('users-9', 'users');
      },
    });
    expect(await service.ensureLayout(ctx)).toEqual({
      driveId: 'drive-9',
      rootItemId: 'root-9',
      usersFolderItemId: 'users-9',
    });
    expect(made).toEqual(['root', 'users']);
    const names = graph.request.mock.calls
      .filter((c) => c[2]?.method === 'POST')
      .map((c) => JSON.parse(c[2].body).name);
    expect(names).toEqual(['FileForge-Central', 'users']);
    expect(calls.some((c) => c.includes('root:/FileForge/') || c.endsWith('root:/FileForge'))).toBe(false); // never the personal folder
  });

  it('adopts existing folders instead of creating new ones', async () => {
    const { service, graph } = setup();
    const calls = route(graph, {
      'GET /me/drive': { id: 'drive-9' },
      'GET /drives/drive-9/root:/FileForge-Central': {
        ...folder('root-9', 'FileForge-Central'),
        parentReference: { driveId: 'drive-9' },
      },
      'GET /drives/drive-9/items/root-9:/users': {
        ...folder('users-9', 'users'),
        parentReference: { driveId: 'drive-9' },
      },
    });
    await service.ensureLayout(ctx);
    expect(calls.some((c) => c.startsWith('POST'))).toBe(false);
  });

  it('never adopts something that is not a folder, or lives in another drive', async () => {
    const { service, graph } = setup();
    route(graph, {
      'GET /me/drive': { id: 'drive-9' },
      'GET /drives/drive-9/root:/FileForge-Central': {
        id: 'x',
        name: 'FileForge-Central',
        file: {},
        parentReference: { driveId: 'drive-9' },
      },
    });
    await expect(service.ensureLayout(ctx)).rejects.toBeInstanceOf(MicrosoftApiError);

    route(graph, {
      'GET /me/drive': { id: 'drive-9' },
      'GET /drives/drive-9/root:/FileForge-Central': {
        ...folder('x', 'FileForge-Central'),
        parentReference: { driveId: 'somebody-else' },
      },
    });
    await expect(service.ensureLayout(ctx)).rejects.toBeInstanceOf(MicrosoftApiError);
  });
});
