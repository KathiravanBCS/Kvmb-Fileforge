import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-types';
import { queryKeys } from '@/lib/query-keys';

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      try {
        await api.auth.logout();
      } catch (error) {
        // 401 means the session is already gone (expired, or signed out in another tab): that is the goal.
        if (!(error instanceof ApiError && error.status === 401)) throw error;
      }
    },
    onSuccess: () => {
      // Drop everything cached for the previous session, then record that there is no session.
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.auth.me[0] });
      queryClient.setQueryData(queryKeys.auth.me, null);
    },
  });
}
