import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useCurrentUserId } from '../hooks/useCurrentUserId';

/** Status of the central OneDrive connection. Never any token. Administrators only (the API enforces it). */
export function useGetConnection(enabled = true) {
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: queryKeys.centralStorage.connection(userId ?? ''),
    queryFn: ({ signal }) => api.centralStorage.admin.connection.get({ signal }),
    enabled: userId !== undefined && enabled,
    retry: false,
  });
}
