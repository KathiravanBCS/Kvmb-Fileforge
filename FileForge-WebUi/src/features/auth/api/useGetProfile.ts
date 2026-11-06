import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-types';
import { queryKeys } from '@/lib/query-keys';

/** The signed-in user, or `null` when there is no session (HTTP 401). Any other failure is an error. */
export function useGetProfile() {
  return useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: async ({ signal }) => {
      try {
        return await api.auth.getMe({ signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
  });
}
