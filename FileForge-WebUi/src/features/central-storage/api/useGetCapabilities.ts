import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useCurrentUserId } from '../hooks/useCurrentUserId';

/** What the API says the signed-in user can do (administrator status, whether storage is usable, the size limit). */
export function useGetCapabilities() {
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: queryKeys.centralStorage.capabilities(userId ?? ''),
    queryFn: ({ signal }) => api.centralStorage.capabilities({ signal }),
    enabled: userId !== undefined,
    retry: false,
    staleTime: 15_000,
  });
}
