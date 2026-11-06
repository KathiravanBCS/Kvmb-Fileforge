import { beforeEach, describe, expect, it, vi } from 'vitest';

import { recoveryItem, recoverySummary } from '@/test/fixtures';
import { api } from './api';
import { apiClient } from './api-client';
import { ApiError } from './api-types';

// The real service layer over a stubbed HTTP client: these tests are about WHICH endpoint is called and WHAT is sent.
vi.mock('./api-client', () => ({
  API_URL: 'http://localhost:4000/api/v1',
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn(), download: vi.fn() },
}));

const http = vi.mocked(apiClient);
const recovery = api.centralStorage.admin.recovery;
const detail = { item: recoveryItem(), events: [{ action: 'central_storage.recovery.repaired', actorType: 'system', occurredAt: '2026-11-06T08:00:00.000Z', details: { toStatus: 'ready' } }] };

beforeEach(() => vi.clearAllMocks());

describe('recovery (administrators)', () => {
  it('reads the summary from the admin recovery route', async () => {
    http.get.mockResolvedValue(recoverySummary());
    expect(await recovery.summary()).toMatchObject({ needsReview: 1, worker: { enabled: true } });
    expect(http.get).toHaveBeenCalledWith('/admin/central-storage/recovery/summary', undefined);
  });

  it('lists one queue at a time, as one page of 100', async () => {
    http.get.mockResolvedValue({ items: [recoveryItem()], page: 1, pageSize: 100, total: 1 });
    await recovery.list('needs_review');
    expect(http.get).toHaveBeenCalledWith(
      '/admin/central-storage/recovery/items',
      expect.objectContaining({ params: { state: 'needs_review', page: 1, pageSize: 100 } }),
    );
  });

  it('reads one file with its history', async () => {
    http.get.mockResolvedValue(detail);
    expect((await recovery.detail('30')).events[0]?.action).toBe('central_storage.recovery.repaired');
    expect(http.get).toHaveBeenCalledWith('/admin/central-storage/recovery/items/30', undefined);
  });

  it('retry and dismiss are POSTs with no body (the id is in the path, and CSRF is the client’s job)', async () => {
    http.post.mockResolvedValue({ outcome: 'repaired', item: recoveryItem() });
    await recovery.retry('30');
    await recovery.dismiss('30');
    expect(http.post).toHaveBeenNthCalledWith(1, '/admin/central-storage/recovery/items/30/retry', undefined, undefined);
    expect(http.post).toHaveBeenNthCalledWith(2, '/admin/central-storage/recovery/items/30/dismiss', undefined, undefined);
  });

  it('encodes the id in the path', async () => {
    http.get.mockResolvedValue(detail);
    await recovery.detail('1/../2');
    expect(http.get.mock.calls[0]?.[0]).toBe('/admin/central-storage/recovery/items/1%2F..%2F2');
  });

  it('refuses a response that does not match the contract, instead of showing guesses', async () => {
    http.get.mockResolvedValue({ needsReview: 'many' });
    await expect(recovery.summary()).rejects.toBeInstanceOf(ApiError);
    http.post.mockResolvedValue({ outcome: 'repaired' });
    await expect(recovery.retry('30')).rejects.toThrow(/unexpected response/);
  });

  it('rejects an item with an unknown state', async () => {
    http.get.mockResolvedValue({ items: [{ ...recoveryItem(), state: 'exploded' }], page: 1, pageSize: 100, total: 1 });
    await expect(recovery.list('all')).rejects.toBeInstanceOf(ApiError);
  });

  it('the own-files API has no recovery routes at all', () => {
    expect(Object.keys(api.centralStorage.me)).not.toContain('recovery');
  });
});
