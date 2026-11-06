import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-types';
import { setSessionEndedHandler } from '@/lib/auth/session';
import { queryKeys } from '@/lib/query-keys';
import { useGetProfile } from './api/useGetProfile';
import { useLogout } from './api/useLogout';
import { AuthContext } from './AuthContext';
import type { AuthContextValue, AuthState } from './types';

// Preview is only possible in `vite dev`, and only when the auth endpoint is missing or unreachable.
function isPreviewCandidate(error: unknown): boolean {
  return import.meta.env.DEV && error instanceof ApiError && (error.isNetworkError || error.status === 404);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useGetProfile();
  const { refetch: refetchUser } = query;
  const { mutateAsync: logoutRequest } = useLogout();

  // Everything cached belongs to the user that was signed in. When the signed-in user changes or goes away (sign-out,
  // a session that ended, a different account), drop it all, so nothing private is ever shown to the next person.
  const currentUserId = query.isPending ? undefined : (query.data?.id ?? null);
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (currentUserId === undefined) return;
    if (previousUserId.current !== undefined && previousUserId.current !== currentUserId) {
      queryClient.removeQueries({ predicate: (cached) => cached.queryKey[0] !== queryKeys.auth.me[0] });
    }
    previousUserId.current = currentUserId;
  }, [currentUserId, queryClient]);

  // Any API call that finds the session gone lands here, so the sign-in screen shows without each page checking.
  useEffect(() => {
    setSessionEndedHandler(() => queryClient.setQueryData(queryKeys.auth.me, null));
    return () => setSessionEndedHandler(null);
  }, [queryClient]);

  const logout = useCallback(() => logoutRequest(), [logoutRequest]);
  const refetch = useCallback(() => void refetchUser(), [refetchUser]);

  const value = useMemo<AuthContextValue>(() => {
    const actions = { login: () => window.location.assign(api.auth.getLoginUrl()), logout, refetch };

    let state: AuthState;
    if (query.isPending) {
      state = { status: 'loading', user: null };
    } else if (query.isError) {
      state = isPreviewCandidate(query.error)
        ? { status: 'preview', user: null }
        : {
            status: 'error',
            user: null,
            // The client only ever throws ApiError; the fallback covers anything unexpected.
            error: query.error instanceof ApiError ? query.error : new ApiError('An unexpected error occurred.', { cause: query.error }),
          };
    } else if (query.data) {
      state = { status: 'authenticated', user: query.data };
    } else {
      state = { status: 'unauthenticated', user: null };
    }
    return { ...state, ...actions };
  }, [query.isPending, query.isError, query.error, query.data, logout, refetch]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
