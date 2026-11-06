import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useCurrentUserId } from '../hooks/useCurrentUserId';
import type { CentralScope } from '../types';

export interface ReplaceVariables {
  id: string;
  file: File;
  /** 0 to 1: how much has been SENT. The server then saves it to storage, so 1 does not mean finished. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Replaces the content of an existing file (its name, owner and place in the list stay). Can be cancelled with `signal`. */
export function useReplaceCentralFile(scope: CentralScope) {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();
  const files = scope === 'admin' ? api.centralStorage.admin : api.centralStorage.me;

  return useMutation({
    mutationFn: ({ id, file, onProgress, signal }: ReplaceVariables) => files.replaceContent(id, file, { onProgress, signal }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.centralStorage.all(userId ?? '') }),
  });
}
