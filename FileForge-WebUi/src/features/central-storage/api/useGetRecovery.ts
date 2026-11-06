import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useCurrentUserId } from '../hooks/useCurrentUserId';
import type { RecoveryState } from '../types';

/** How often the dashboard looks again: recovery changes by itself while the page is open. */
const REFRESH_MS = 30_000;

/** Counts for the recovery dashboard and the worker settings. Administrators only (the API enforces it). */
export function useGetRecoverySummary() {
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: queryKeys.centralStorage.recoverySummary(userId ?? ''),
    queryFn: ({ signal }) => api.centralStorage.admin.recovery.summary({ signal }),
    enabled: userId !== undefined,
    refetchInterval: REFRESH_MS,
    retry: false,
  });
}

/** The files that need attention, by queue. */
export function useGetRecoveryItems(state: RecoveryState) {
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: queryKeys.centralStorage.recoveryItems(userId ?? '', state),
    queryFn: ({ signal }) => api.centralStorage.admin.recovery.list(state, { signal }),
    enabled: userId !== undefined,
    refetchInterval: REFRESH_MS,
    retry: false,
  });
}

/** One file with its recovery history. Only asked for while a file is open. */
export function useGetRecoveryItem(id: string | null) {
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: queryKeys.centralStorage.recoveryItem(userId ?? '', id ?? ''),
    queryFn: ({ signal }) => api.centralStorage.admin.recovery.detail(id ?? '', { signal }),
    enabled: userId !== undefined && id !== null,
    retry: false,
  });
}
