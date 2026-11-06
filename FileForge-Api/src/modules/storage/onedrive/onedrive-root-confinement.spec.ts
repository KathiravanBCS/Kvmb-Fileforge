import { Readable } from 'node:stream';

import { ForbiddenException, Logger } from '@nestjs/common';

import type { SessionUser } from '../../../common/types/session.types';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { GraphClient } from '../../microsoft/graph/graph.client';
import { MicrosoftApiError } from '../../microsoft/microsoft.errors';
import type { OneDriveConnectionService } from './onedrive-connection.service';
import { OneDriveFilesService, type StorageRequestContext } from './onedrive-files.service';
import { parseRelativePath } from './onedrive-paths';
import type { GraphDriveItem } from './onedrive.types';

/**
 * The personal File Manager is connected to the administrator's OneDrive, which ALSO holds `FileForge-Central/` (every
 * user's files). Microsoft permissions apply to the whole account, so the File Manager must refuse, by itself, anything
 * that is not inside its own `FileForge` root. These tests are the proof: nothing central can be listed, downloaded,
 * renamed, deleted or uploaded into through it, and its normal flows keep working.
 */
const CONNECTION = { id: 5n, workspaceId: 1n, driveId: 'drive-1', rootItemId: 'root-1' };
const USER: SessionUser = { id: '1', email: 'admin@example.com', displayName: null };
const INSIDE = '/drive/root:/FileForge/invoices';
const CENTRAL = '/drive/root:/FileForge-Central/users/2';

const item = (over: Partial<GraphDriveItem> = {}): GraphDriveItem => ({
  id: 'item-1',
  name: 'a.pdf',
  size: 10,
  eTag: 'e',
  file: { mimeType: 'application/pdf' },
  parentReference: { driveId: 'drive-1', id: 'parent-1', path: INSIDE },
  ...over,
});
const inPath = (path: string, over: Partial<GraphDriveItem> = {}) =>
  item({ parentReference: { driveId: 'drive-1', id: 'parent-1', path }, ...over });
const folderItem = (name: string, path = '/drive/root:/FileForge') =>
  item({
    id: `f-${name}`,
    name,
    file: undefined,
    folder: { childCount: 0 },
    parentReference: { driveId: 'drive-1', id: 'p', path },
  });

function setup() {
  const graph = {
    request: jest.fn(),
    requestRaw: jest.fn(),
    pathFromLink: jest.fn(),
  };
  const files = {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
  };
  const connections = { requireUsable: jest.fn().mockResolvedValue(CONNECTION) };
  const service = new OneDriveFilesService(
    { files } as unknown as PrismaService,
    graph as unknown as GraphClient,
    connections as unknown as OneDriveConnectionService,
  );
  const ctx: StorageRequestContext = { workspaceId: '1', user: USER, session: { homeAccountId: 'home-1', cookie: {} } };
  const mutating = () => [
    ...graph.requestRaw.mock.calls,
    ...graph.request.mock.calls.filter((c) => ['PUT', 'PATCH', 'DELETE', 'POST'].includes(c[2]?.method)),
  ];
  return { service, graph, files, ctx, mutating };
}

/** Graph by "METHOD path" (longest registered prefix wins). Anything unregistered is a 404. */
function route(graph: ReturnType<typeof setup>['graph'], routes: Record<string, unknown>) {
  const calls: string[] = [];
  graph.request.mockImplementation((_c: unknown, path: string, options?: { method?: string }) => {
    const key = `${options?.method ?? 'GET'} ${path.split('?')[0]}`;
    calls.push(key);
    const match = Object.keys(routes)
      .filter((prefix) => key === prefix || key.startsWith(prefix))
      .sort((a, b) => b.length - a.length)[0];
    if (match === undefined) return Promise.reject(new MicrosoftApiError('not_found'));
    const value = routes[match];
    const result = typeof value === 'function' ? (value as () => unknown)() : value;
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  });
  return calls;
}

const outcome = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ForbiddenException) return (error.getResponse() as { code?: string }).code;
    return (error as { response?: { code?: string } }).response?.code ?? 'OTHER';
  }
  return 'ALLOWED';
};

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe('the personal File Manager stays inside FileForge/', () => {
  describe('files that really are inside FileForge still work (nothing changed for normal use)', () => {
    it('lists, downloads, renames, deletes and uploads', async () => {
      const { service, graph, ctx } = setup();
      route(graph, {
        'GET /drives/drive-1/items/root-1:/invoices:/children': { value: [item(), folderItem('2026', INSIDE)] },
        'GET /drives/drive-1/items/root-1:/invoices/a.pdf': item(),
        'GET /drives/drive-1/items/root-1:/invoices': folderItem('invoices'),
        'PATCH /drives/drive-1/items/item-1': item({ name: 'b.pdf' }),
        'DELETE /drives/drive-1/items/item-1': undefined,
        'PUT /drives/drive-1/items/root-1:/invoices/n.pdf:/content': item({ id: 'new', name: 'n.pdf' }),
      });
      graph.requestRaw.mockResolvedValue({ body: Readable.toWeb(Readable.from([Buffer.from('x')])) });

      expect((await service.list(ctx, 'invoices')).items.map((i) => i.name)).toEqual(['2026', 'a.pdf']);
      expect(await outcome(service.download(ctx, 'invoices/a.pdf'))).toBe('ALLOWED');
      expect(await outcome(service.rename(ctx, 'invoices/a.pdf', 'b.pdf'))).toBe('ALLOWED');
      expect(await outcome(service.delete(ctx, 'invoices/a.pdf'))).toBe('ALLOWED');
      expect(await outcome(service.upload(ctx, 'invoices', { name: 'n.pdf', buffer: Buffer.from('x') }))).toBe(
        'ALLOWED',
      );
    });

    it('the FileForge root itself is a valid upload target', async () => {
      const { service, graph, ctx } = setup();
      route(graph, {
        'GET /drives/drive-1/items/root-1': item({
          id: 'root-1',
          name: 'FileForge',
          file: undefined,
          folder: {},
          parentReference: { driveId: 'drive-1', path: '/drive/root:' },
        }),
        'PUT /drives/drive-1/items/root-1:/top.txt:/content': item({
          id: 'top',
          name: 'top.txt',
          parentReference: { driveId: 'drive-1', path: '/drive/root:/FileForge' },
        }),
      });
      expect(await outcome(service.upload(ctx, '', { name: 'top.txt', buffer: Buffer.from('x') }))).toBe('ALLOWED');
    });

    it('is case-insensitive like OneDrive itself', async () => {
      const { service, graph, ctx } = setup();
      route(graph, { 'GET /drives/drive-1/items/root-1:/a.pdf': inPath('/drive/root:/fileforge/Invoices') });
      graph.requestRaw.mockResolvedValue({ body: Readable.toWeb(Readable.from([Buffer.from('x')])) });
      expect(await outcome(service.download(ctx, 'a.pdf'))).toBe('ALLOWED');
    });
  });

  describe('FileForge-Central is refused for every operation, before anything is changed', () => {
    const PATHS = [
      ['the central root path', CENTRAL],
      ['a different case', '/drive/root:/fileforge-central/users/2'],
      ['upper case', '/drive/root:/FILEFORGE-CENTRAL/users/2'],
      ['a percent-encoded name', '/drive/root:/FileForge%2DCentral/users/2'],
      ['a drives-style path', '/drives/b!xyz/root:/FileForge-Central/users/2'],
      ['a lookalike folder (prefix is not a boundary)', '/drive/root:/FileForgeX/a'],
      ['a folder next to FileForge', '/drive/root:/Documents'],
      ['the drive root', '/drive/root:'],
    ] as const;

    it.each(PATHS)('download of an item Graph places in %s', async (_label, path) => {
      const { service, graph, ctx, mutating } = setup();
      route(graph, { 'GET /drives/drive-1/items/root-1:/x.pdf': inPath(path) });
      expect(await outcome(service.download(ctx, 'x.pdf'))).toBe('ITEM_OUTSIDE_STORAGE_ROOT');
      expect(graph.requestRaw).not.toHaveBeenCalled();
      expect(mutating()).toHaveLength(0);
    });

    it.each(PATHS)('rename of an item Graph places in %s', async (_label, path) => {
      const { service, graph, files, ctx, mutating } = setup();
      route(graph, { 'GET /drives/drive-1/items/root-1:/x.pdf': inPath(path) });
      expect(await outcome(service.rename(ctx, 'x.pdf', 'renamed.pdf'))).toBe('ITEM_OUTSIDE_STORAGE_ROOT');
      expect(mutating()).toHaveLength(0);
      expect(files.update).not.toHaveBeenCalled();
      expect(files.create).not.toHaveBeenCalled();
    });

    it.each(PATHS)('delete of an item Graph places in %s', async (_label, path) => {
      const { service, graph, files, ctx, mutating } = setup();
      route(graph, { 'GET /drives/drive-1/items/root-1:/x.pdf': inPath(path) });
      expect(await outcome(service.delete(ctx, 'x.pdf'))).toBe('ITEM_OUTSIDE_STORAGE_ROOT');
      expect(mutating()).toHaveLength(0);
      expect(files.update).not.toHaveBeenCalled(); // not even the metadata was touched
    });

    it.each(PATHS)('upload INTO a folder Graph places in %s', async (_label, path) => {
      const { service, graph, files, ctx, mutating } = setup();
      route(graph, {
        'GET /drives/drive-1/items/root-1:/target': inPath(path, {
          id: 'dir',
          name: 'target',
          file: undefined,
          folder: {},
        }),
      });
      expect(await outcome(service.upload(ctx, 'target', { name: 'evil.pdf', buffer: Buffer.from('x') }))).toBe(
        'ITEM_OUTSIDE_STORAGE_ROOT',
      );
      expect(mutating()).toHaveLength(0);
      expect(files.create).not.toHaveBeenCalled();
    });

    it('listings never show items Graph places outside FileForge', async () => {
      const { service, graph, ctx } = setup();
      route(graph, {
        'GET /drives/drive-1/items/root-1/children': {
          value: [
            inPath('/drive/root:/FileForge', { id: 'ok', name: 'ok.txt' }),
            inPath(CENTRAL, { id: 'c', name: 'central.pdf' }),
            inPath('/drive/root:/fileforge-central', { id: 'c2', name: 'central-folder', file: undefined, folder: {} }),
            item({ id: 'u', name: 'unknown-path.txt', parentReference: { driveId: 'drive-1', id: 'p' } }), // no path: unchanged behaviour
          ],
        },
      });
      expect((await service.list(ctx, '')).items.map((i) => i.name)).toEqual(['ok.txt', 'unknown-path.txt']);
    });
  });

  describe('a central item id cannot be smuggled in (the API takes relative paths only, never ids)', () => {
    it.each(['01ABCDEF2345CENTRALITEMID', 'b!driveid/01CENTRAL', 'items/01CENTRAL'])(
      'download of %j is resolved as a NAME under the FileForge root, never as an item id',
      async (value) => {
        const { service, graph, ctx } = setup();
        const calls = route(graph, {}); // nothing exists: every path is a 404
        expect(await outcome(service.download(ctx, value))).toBe('ITEM_NOT_FOUND');
        for (const call of calls) expect(call).toMatch(/^GET \/drives\/drive-1\/items\/root-1:\//); // always under the stored root item
        expect(graph.requestRaw).not.toHaveBeenCalled();
      },
    );

    it('a path that happens to name the central folder is just a (missing) child of FileForge, not the central root', async () => {
      const { service, graph, ctx } = setup();
      const calls = route(graph, {});
      expect(await outcome(service.list(ctx, 'FileForge-Central/users/2'))).toBe('ITEM_NOT_FOUND');
      expect(calls).toEqual(['GET /drives/drive-1/items/root-1:/FileForge-Central/users/2:/children']);
      expect(calls[0]).not.toMatch(/\/root:\/FileForge-Central/);
    });

    it.each([
      ['parent traversal', '../FileForge-Central'],
      ['traversal in the middle', 'invoices/../../FileForge-Central'],
      ['a bare ..', '..'],
      ['an absolute path', '/FileForge-Central/users/2'],
      ['a drive-root style path', 'root:/FileForge-Central'],
      ['a backslash', '..\\FileForge-Central'],
      ['an empty segment', 'invoices//x'],
      ['a trailing slash', 'invoices/'],
      ['a dot segment', './x'],
      ['a control character', 'a\u0000b'],
      ['a right-to-left override', 'gpj‮txt.exe'],
    ])('%s is rejected before any request is made', async (_label, path) => {
      const { service, graph, ctx } = setup();
      expect(await outcome(service.list(ctx, path))).toBe('INVALID_PATH');
      expect(() => parseRelativePath(path, { allowRoot: true })).toThrow();
      expect(graph.request).not.toHaveBeenCalled();
    });
  });

  describe('when Graph gives no ancestry path, the parent chain is walked up to the stored root', () => {
    const noPath = (parentId: string, over: Partial<GraphDriveItem> = {}) =>
      item({ parentReference: { driveId: 'drive-1', id: parentId }, ...over });

    it('allows an item whose parents lead to the FileForge root', async () => {
      const { service, graph, ctx } = setup();
      const calls = route(graph, {
        'GET /drives/drive-1/items/root-1:/a/b.pdf': noPath('dir-b'),
        'GET /drives/drive-1/items/dir-b': { id: 'dir-b', parentReference: { driveId: 'drive-1', id: 'dir-a' } },
        'GET /drives/drive-1/items/dir-a': { id: 'dir-a', parentReference: { driveId: 'drive-1', id: 'root-1' } },
      });
      graph.requestRaw.mockResolvedValue({ body: Readable.toWeb(Readable.from([Buffer.from('x')])) });
      expect(await outcome(service.download(ctx, 'a/b.pdf'))).toBe('ALLOWED');
      expect(calls.filter((c) => c.includes('/items/dir-'))).toHaveLength(2);
    });

    it('refuses an item whose parents end at the drive root without passing the FileForge root (e.g. central)', async () => {
      const { service, graph, ctx, mutating } = setup();
      route(graph, {
        'GET /drives/drive-1/items/root-1:/x.pdf': noPath('central-user-folder'),
        'GET /drives/drive-1/items/central-user-folder': {
          id: 'central-user-folder',
          parentReference: { driveId: 'drive-1', id: 'central-root' },
        },
        'GET /drives/drive-1/items/central-root': {
          id: 'central-root',
          parentReference: { driveId: 'drive-1', id: 'drive-top' },
        },
        'GET /drives/drive-1/items/drive-top': { id: 'drive-top', parentReference: { driveId: 'drive-1' } }, // no parent: the drive root
      });
      expect(await outcome(service.rename(ctx, 'x.pdf', 'y.pdf'))).toBe('ITEM_OUTSIDE_STORAGE_ROOT');
      expect(mutating()).toHaveLength(0);
    });

    it('refuses when the chain leaves the drive, is cyclic, or is absurdly deep (bounded, no endless loop)', async () => {
      const { service, graph, ctx } = setup();
      route(graph, {
        'GET /drives/drive-1/items/root-1:/x.pdf': noPath('p0'),
        'GET /drives/drive-1/items/p0': { id: 'p0', parentReference: { driveId: 'another-drive', id: 'root-1' } },
      });
      expect(await outcome(service.download(ctx, 'x.pdf'))).toBe('ITEM_OUTSIDE_STORAGE_ROOT');

      const cyclic = route(graph, {
        'GET /drives/drive-1/items/root-1:/x.pdf': noPath('loop'),
        'GET /drives/drive-1/items/loop': { id: 'loop', parentReference: { driveId: 'drive-1', id: 'loop' } },
      });
      expect(await outcome(service.download(ctx, 'x.pdf'))).toBe('ITEM_OUTSIDE_STORAGE_ROOT');
      expect(cyclic.length).toBeLessThanOrEqual(14);
    });

    it('refuses a shortcut (remoteItem) and an item from another drive outright', async () => {
      const { service, graph, ctx } = setup();
      route(graph, { 'GET /drives/drive-1/items/root-1:/s': item({ remoteItem: { id: 'x' } }) });
      expect(await outcome(service.download(ctx, 's'))).toBe('ITEM_OUTSIDE_STORAGE_ROOT');
      route(graph, {
        'GET /drives/drive-1/items/root-1:/o': item({ parentReference: { driveId: 'other', path: INSIDE } }),
      });
      expect(await outcome(service.download(ctx, 'o'))).toBe('ITEM_OUTSIDE_STORAGE_ROOT');
    });
  });
});
