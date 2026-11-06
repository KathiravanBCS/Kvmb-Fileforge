import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useCurrentUserId } from '../hooks/useCurrentUserId';
import type { CentralScope } from '../types';

/** Changes a file's display name (the extension must stay the same; only the database changes, never OneDrive). */
export function useRenameCentralFile(scope: CentralScope) {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();
  const files = scope === 'admin' ? api.centralStorage.admin : api.centralStorage.me;

  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => files.rename(id, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.centralStorage.all(userId ?? '') }),
  });
}
