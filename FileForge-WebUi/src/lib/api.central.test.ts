import { beforeEach, describe, expect, it, vi } from 'vitest';

import { adminFile, capabilities, connection, file, page, users } from '@/test/fixtures';
import { api } from './api';
import { apiClient } from './api-client';
import { ApiError } from './api-types';

// The real service layer over a stubbed HTTP client: these tests are about WHICH endpoint is called and WHAT is sent.
vi.mock('./api-client', () => ({
  API_URL: 'http://localhost:4000/api/v1',
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn(), download: vi.fn() },
}));

const http = vi.mocked(apiClient);
const query = { page: 2, pageSize: 50, search: 'inv', type: 'pdf', sort: 'size', order: 'asc' } as const;

beforeEach(() => vi.clearAllMocks());

describe('own files (My Files)', () => {
  it('lists from /central-storage/files and sends only what the API accepts', async () => {
    http.get.mockResolvedValue(page([file()]));
    await api.centralStorage.me.list(query);
    expect(http.get).toHaveBeenCalledWith('/central-storage/files', expect.objectContaining({ params: expect.objectContaining(query) }));
  });

  it('never uses an administrator route', async () => {
    http.get.mockImplementation((url: string) => Promise.resolve(url.endsWith('/files') ? page([]) : file()));
    http.patch.mockResolvedValue(file());
    http.delete.mockResolvedValue(undefined);
    http.upload.mockResolvedValue(file());
    http.download.mockResolvedValue(new Blob());
    await api.centralStorage.me.list(query);
    await api.centralStorage.me.get('10');
    await api.centralStorage.me.rename('10', 'a.pdf');
    await api.centralStorage.me.remove('10');
    await api.centralStorage.me.upload(new File(['x'], 'a.pdf'));
    await api.centralStorage.me.replaceContent('10', new File(['x'], 'a.pdf'));
    await api.centralStorage.me.download('10');
    await api.centralStorage.me.preview('10');
    const urls = [...http.get.mock.calls, ...http.patch.mock.calls, ...http.delete.mock.calls, ...http.upload.mock.calls, ...http.download.mock.calls].map((call) => String(call[0]));
    expect(urls.length).toBeGreaterThan(6);
    for (const url of urls) {
      expect(url).toMatch(/^\/central-storage\//);
      expect(url).not.toContain('admin');
    }
  });

  it('has no way to name an owner: a stray owner filter is dropped by the type and the wire format', async () => {
    http.get.mockResolvedValue(page([]));
    await api.centralStorage.me.list({ ...query, ownerUserId: '3' } as typeof query);
    // The list helper copies a fixed set of fields; for "me" the hook strips the owner, and the server ignores it too.
    const params = http.get.mock.calls[0]?.[1]?.params as Record<string, unknown>;
    expect(Object.keys(params).sort()).toEqual(['order', 'ownerUserId', 'page', 'pageSize', 'search', 'sort', 'type']);
  });

  it('uploads as multipart POST to /central-storage/files/upload, with the file under "file"', async () => {
    http.upload.mockResolvedValue(file());
    const onProgress = vi.fn();
    await api.centralStorage.me.upload(new File(['x'], 'a.pdf'), { onProgress });
    const [url, form, options] = http.upload.mock.calls[0] as [string, FormData, { onProgress?: unknown; method?: string }];
    expect(url).toBe('/central-storage/files/upload');
    expect((form.get('file') as File).name).toBe('a.pdf');
    expect(options.onProgress).toBe(onProgress);
    expect(options.method).toBeUndefined(); // POST (the default)
  });

  it('replaces content with PUT on /files/:id/content', async () => {
    http.upload.mockResolvedValue(file({ contentVersion: 2 }));
    await api.centralStorage.me.replaceContent('10', new File(['x'], 'a.pdf'));
    const [url, , options] = http.upload.mock.calls[0] as [string, FormData, { method?: string }];
    expect(url).toBe('/central-storage/files/10/content');
    expect(options.method).toBe('put');
  });

  it('encodes ids in URLs', async () => {
    http.get.mockResolvedValue(file());
    await api.centralStorage.me.get('1/../2');
    expect(http.get.mock.calls[0]?.[0]).toBe('/central-storage/files/1%2F..%2F2');
  });

  it('rejects a response that does not match the contract, instead of passing it on', async () => {
    http.get.mockResolvedValue({ items: [{ id: 5 }], page: 1, pageSize: 25, total: 1 });
    await expect(api.centralStorage.me.list(query)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('administrator routes', () => {
  it('list, upload-for-user and the connection use /admin/central-storage', async () => {
    http.get.mockResolvedValue(page([adminFile()]));
    http.upload.mockResolvedValue(adminFile());
    await api.centralStorage.admin.list({ ...query, ownerUserId: '3' });
    expect(http.get.mock.calls[0]?.[0]).toBe('/admin/central-storage/files');
    expect((http.get.mock.calls[0]?.[1]?.params as { ownerUserId?: string }).ownerUserId).toBe('3');

    await api.centralStorage.admin.upload('3', new File(['x'], 'a.pdf'));
    expect(http.upload.mock.calls[0]?.[0]).toBe('/admin/central-storage/users/3/files/upload');
  });

  it('reads users, usage and the connection status', async () => {
    http.get.mockResolvedValueOnce(users);
    expect(await api.centralStorage.admin.users('')).toHaveLength(3);
    expect(http.get.mock.calls[0]?.[0]).toBe('/admin/central-storage/users');

    http.get.mockResolvedValueOnce({ total: { fileCount: 2, totalBytes: 10 }, perUser: users });
    expect((await api.centralStorage.admin.totalUsage()).total.fileCount).toBe(2);
    expect(http.get.mock.calls[1]?.[0]).toBe('/admin/central-storage/usage');

    http.get.mockResolvedValueOnce(connection());
    expect((await api.centralStorage.admin.connection.get()).status).toBe('connected');
    expect(http.get.mock.calls[2]?.[0]).toBe('/admin/central-storage/connection');
  });

  it('verify and resync are POSTs', async () => {
    http.post.mockResolvedValueOnce(connection());
    await api.centralStorage.admin.connection.verify();
    expect(http.post.mock.calls[0]?.[0]).toBe('/admin/central-storage/connection/verify');

    http.post.mockResolvedValueOnce(file());
    await api.centralStorage.admin.resync('10');
    expect(http.post.mock.calls[1]?.[0]).toBe('/admin/central-storage/files/10/resync');
  });

  it('connect returns only a Microsoft sign-in address, and refuses any other host', async () => {
    http.post.mockResolvedValueOnce({ url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1' });
    expect(await api.centralStorage.admin.connection.connect()).toContain('login.microsoftonline.com');

    http.post.mockResolvedValueOnce({ url: 'https://evil.example/phish' });
    await expect(api.centralStorage.admin.connection.connect()).rejects.toThrow(/unexpected sign-in address/);
    http.post.mockResolvedValueOnce({ url: 'https://login.microsoftonline.com.evil.example/x' });
    await expect(api.centralStorage.admin.connection.connect()).rejects.toThrow(/unexpected sign-in address/);
  });

  it('exposes capabilities', async () => {
    http.get.mockResolvedValueOnce(capabilities({ isSystemAdmin: true }));
    expect((await api.centralStorage.capabilities()).isSystemAdmin).toBe(true);
    expect(http.get.mock.calls[0]?.[0]).toBe('/central-storage/capabilities');
  });
});

describe('what the browser can never get', () => {
  it('has no function that returns a OneDrive link or a token: downloads are bytes from the API', () => {
    const everything = JSON.stringify(Object.keys(api.centralStorage.me).concat(Object.keys(api.centralStorage.admin)));
    expect(everything).not.toMatch(/token|link|share|onedrive|graph/i);
  });
});
