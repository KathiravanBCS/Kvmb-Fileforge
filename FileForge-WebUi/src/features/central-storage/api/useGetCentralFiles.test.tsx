import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthContext } from '@/features/auth/AuthContext';
import { api } from '@/lib/api';
import { adminFile, file, page } from '@/test/fixtures';
import { ADMIN, ALICE, createTestQueryClient } from '@/test/renderWithProviders';
import { useGetCentralFiles } from './useGetCentralFiles';

vi.mock('@/lib/api');

const meList = vi.mocked(api.centralStorage.me.list);
const adminList = vi.mocked(api.centralStorage.admin.list);
const query = { page: 1, pageSize: 25, sort: 'date', order: 'desc', ownerUserId: '3', search: 'x' } as const;

const wrap = (user: typeof ALICE | null, client = createTestQueryClient()) =>
  function Wrapper({ children }: { children: ReactNode }) {
    const value = user
      ? ({ status: 'authenticated', user, login: () => undefined, logout: () => Promise.resolve(), refetch: () => undefined } as const)
      : ({ status: 'unauthenticated', user: null, login: () => undefined, logout: () => Promise.resolve(), refetch: () => undefined } as const);
    return (
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
      </QueryClientProvider>
    );
  };

beforeEach(() => {
  meList.mockResolvedValue(page([file()]));
  adminList.mockResolvedValue(page([adminFile()]));
});

describe('useGetCentralFiles', () => {
  it('"me" never sends an owner filter, even if the caller still has one in its state', async () => {
    const { result } = renderHook(() => useGetCentralFiles('me', query), { wrapper: wrap(ALICE) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const sent = meList.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(sent).not.toHaveProperty('ownerUserId');
    expect(sent).toMatchObject({ search: 'x', page: 1 });
    expect(adminList).not.toHaveBeenCalled();
  });

  it('"admin" sends the owner filter to the administrator API', async () => {
    const { result } = renderHook(() => useGetCentralFiles('admin', query), { wrapper: wrap(ADMIN) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(adminList.mock.calls[0]?.[0]).toMatchObject({ ownerUserId: '3' });
    expect(meList).not.toHaveBeenCalled();
  });

  it('asks for nothing without a signed-in user', () => {
    renderHook(() => useGetCentralFiles('me', query), { wrapper: wrap(null) });
    expect(meList).not.toHaveBeenCalled();
  });

  it('keeps each user’s data under their own cache key: another user never receives it', async () => {
    const client = createTestQueryClient();
    const first = renderHook(() => useGetCentralFiles('me', query), { wrapper: wrap(ALICE, client) });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    meList.mockClear();
    meList.mockResolvedValue(page([file({ id: '77', name: 'bobs-file.pdf', ownerId: '3' })]));

    // A different account in the same query cache (e.g. a cache that was not cleared): it must fetch its own list.
    const second = renderHook(() => useGetCentralFiles('me', query), { wrapper: wrap({ ...ALICE, id: '3', email: 'bob@example.com' }, client) });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(meList).toHaveBeenCalledTimes(1);
    expect(second.result.current.data?.items[0]?.name).toBe('bobs-file.pdf');
    const keys = client.getQueryCache().findAll().map((entry) => entry.queryKey[1]);
    expect(new Set(keys)).toEqual(new Set(['2', '3']));
  });
});
