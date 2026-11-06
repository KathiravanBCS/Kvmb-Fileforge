import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useRenameFile(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { path: string; newName: string }) =>
      api.storage.oneDrive.rename(workspaceId as string, input.path, input.newName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.oneDrive.all(workspaceId ?? '') }),
  });
}
