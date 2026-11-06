import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useCurrentUserId } from '../hooks/useCurrentUserId';
import type { CentralScope } from '../types';

/** Deletes a file (it goes to the OneDrive recycle bin). */
export function useDeleteCentralFile(scope: CentralScope) {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();
  const files = scope === 'admin' ? api.centralStorage.admin : api.centralStorage.me;

  return useMutation({
    mutationFn: (id: string) => files.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.centralStorage.all(userId ?? '') }),
  });
}
