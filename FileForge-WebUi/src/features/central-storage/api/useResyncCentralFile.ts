import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useCurrentUserId } from '../hooks/useCurrentUserId';

/** Administrators only: re-reads a file from OneDrive and repairs its record (a replacement stored but not recorded). */
export function useResyncCentralFile() {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();

  return useMutation({
    mutationFn: (id: string) => api.centralStorage.admin.resync(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.centralStorage.all(userId ?? '') }),
  });
}
