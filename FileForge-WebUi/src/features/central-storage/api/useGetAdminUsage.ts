import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useCurrentUserId } from '../hooks/useCurrentUserId';

/** Total storage in use and the usage of every user that has files. Administrators only (the API enforces it). */
export function useGetAdminUsage(enabled = true) {
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: queryKeys.centralStorage.usage(userId ?? '', 'admin'),
    queryFn: ({ signal }) => api.centralStorage.admin.totalUsage({ signal }),
    enabled: userId !== undefined && enabled,
    retry: false,
  });
}
