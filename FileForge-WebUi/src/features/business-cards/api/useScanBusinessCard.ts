import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useWorkspaceScope } from '@/features/workspaces/hooks/useWorkspaceScope';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

/** Uploads a card photo. The API reads it, stores the photo and returns a PENDING scan to review. */
export function useScanBusinessCard() {
  const queryClient = useQueryClient();
  const { userId, workspaceId } = useWorkspaceScope();
  return useMutation({
    mutationFn: ({ front, back, onProgress }: { front: File; back?: File; onProgress?: (fraction: number) => void }) =>
      api.businessCards.scan(workspaceId as string, { front, back }, { onProgress }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.businessCards.all(userId ?? '', workspaceId ?? '') }),
  });
}
