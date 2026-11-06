import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useCurrentUserId } from '../hooks/useCurrentUserId';

/** Active users with their storage usage: the choices for "upload for user" and the owner filter. */
export function useGetAdminUsers(search = '', enabled = true) {
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: queryKeys.centralStorage.adminUsers(userId ?? '', search),
    queryFn: ({ signal }) => api.centralStorage.admin.users(search, { signal }),
    enabled: userId !== undefined && enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });
}
