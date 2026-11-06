import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useCurrentUserId } from '../hooks/useCurrentUserId';

/** The signed-in user's own usage (file count and bytes). Administrators' totals come from `useGetAdminUsage`. */
export function useGetCentralUsage(enabled = true) {
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: queryKeys.centralStorage.usage(userId ?? '', 'me'),
    queryFn: ({ signal }) => api.centralStorage.me.usage({ signal }),
    enabled: userId !== undefined && enabled,
    retry: false,
  });
}
