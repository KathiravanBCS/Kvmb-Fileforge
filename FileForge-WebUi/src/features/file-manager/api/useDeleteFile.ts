import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useDeleteFile(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.storage.oneDrive.remove(workspaceId as string, path),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.oneDrive.all(workspaceId ?? '') }),
  });
}
