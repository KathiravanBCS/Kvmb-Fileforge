import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useCurrentUserId } from '../hooks/useCurrentUserId';

/** Asks the API to check the central OneDrive now (health, quota). The answer replaces the cached status. */
export function useVerifyConnection() {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId() ?? '';

  return useMutation({
    mutationFn: () => api.centralStorage.admin.connection.verify(),
    onSuccess: async (status) => {
      queryClient.setQueryData(queryKeys.centralStorage.connection(userId), status);
      // "Is storage available?" (capabilities) may have changed with it.
      await queryClient.invalidateQueries({ queryKey: queryKeys.centralStorage.capabilities(userId) });
    },
  });
}
