import type { ReactElement, ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AuthContext } from '@/features/auth/AuthContext';
import type { AuthContextValue } from '@/features/auth/types';
import { AbilityProvider } from '@/lib/casl/context';

export const ALICE = { id: '2', email: 'alice@example.com', displayName: 'Alice' };
export const ADMIN = { id: '1', email: 'admin@example.com', displayName: 'Admin' };

export interface RenderOptions {
  /** The signed-in user. `null` renders as signed out. */
  user?: typeof ALICE | null;
  route?: string;
  client?: QueryClient;
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 }, mutations: { retry: false } } });
}

/**
 * Renders with the same providers the app has (Mantine, TanStack Query, the router, auth) and the REAL ability provider,
 * so what a page shows is derived exactly as in the app: from the (mocked) API's answers, never from a shortcut.
 */
export function renderWithProviders(ui: ReactElement, { user = ALICE, route = '/', client = createTestQueryClient() }: RenderOptions = {}): RenderResult & { client: QueryClient } {
  const auth: AuthContextValue = user
    ? { status: 'authenticated', user, login: () => undefined, logout: () => Promise.resolve(), refetch: () => undefined }
    : { status: 'unauthenticated', user: null, login: () => undefined, logout: () => Promise.resolve(), refetch: () => undefined };

  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={client}>
      {/* env="test": no transitions or portals, so modals and menus appear synchronously. */}
      <MantineProvider env="test">
        <Notifications />
        <AuthContext.Provider value={auth}>
          <MemoryRouter initialEntries={[route]}>
            <AbilityProvider>{children}</AbilityProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </MantineProvider>
    </QueryClientProvider>
  );

  const result = render(wrap(ui));
  return { ...result, client, rerender: (next: ReactNode) => result.rerender(wrap(next)) };
}
