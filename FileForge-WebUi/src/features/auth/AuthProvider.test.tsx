import { QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { ADMIN, ALICE, createTestQueryClient } from '@/test/renderWithProviders';
import { AuthProvider } from './AuthProvider';

vi.mock('@/lib/api');

const getMe = vi.mocked(api.auth.getMe);
const cached = (client: ReturnType<typeof createTestQueryClient>) => client.getQueryCache().findAll().map((query) => query.queryKey[0]);

function setup() {
  const client = createTestQueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <div>app</div>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { client, ...view };
}

function seedPrivateData(client: ReturnType<typeof createTestQueryClient>) {
  client.setQueryData(['central-storage', '2', 'me', 'files', { page: 1 }], { items: [{ name: 'alices-secret.pdf' }] });
  client.setQueryData(['central-storage', '2', 'capabilities'], { isSystemAdmin: false });
  client.setQueryData(['onedrive', '1', 'items', ''], { items: [] });
  client.setQueryData(['workspaces'], [{ id: '1' }]);
}

beforeEach(() => getMe.mockResolvedValue(ALICE));

describe('private data never outlives the user it belongs to', () => {
  it('keeps the cache while the same user stays signed in (including the first load)', async () => {
    const { client } = setup();
    seedPrivateData(client);
    await waitFor(() => expect(client.getQueryData(queryKeys.auth.me)).toEqual(ALICE));

    expect(cached(client)).toEqual(expect.arrayContaining(['central-storage', 'onedrive', 'workspaces']));
  });

  it('clears every cached query except the session when the user signs out or the session ends', async () => {
    const { client } = setup();
    await waitFor(() => expect(client.getQueryData(queryKeys.auth.me)).toEqual(ALICE));
    seedPrivateData(client);

    client.setQueryData(queryKeys.auth.me, null); // what the session-ended handler / logout records

    await waitFor(() => expect(cached(client)).toEqual(['auth']));
    expect(client.getQueryData(['central-storage', '2', 'me', 'files', { page: 1 }])).toBeUndefined();
  });

  it('clears everything when a DIFFERENT account takes over the same tab', async () => {
    const { client } = setup();
    await waitFor(() => expect(client.getQueryData(queryKeys.auth.me)).toEqual(ALICE));
    seedPrivateData(client);

    client.setQueryData(queryKeys.auth.me, ADMIN);

    await waitFor(() => expect(cached(client)).toEqual(['auth']));
    expect(client.getQueryData(['central-storage', '2', 'capabilities'])).toBeUndefined();
  });

  it('a refetch that returns the same user does not throw the cache away', async () => {
    const { client } = setup();
    await waitFor(() => expect(client.getQueryData(queryKeys.auth.me)).toEqual(ALICE));
    seedPrivateData(client);

    client.setQueryData(queryKeys.auth.me, { ...ALICE, displayName: 'Alice A.' });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(cached(client)).toEqual(expect.arrayContaining(['central-storage']));
  });
});
