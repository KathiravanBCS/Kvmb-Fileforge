import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useWorkspaceScope } from '@/features/workspaces/hooks/useWorkspaceScope';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { CardPatch } from '../types';

/** Correct a pending card, approve it into the contacts, or reject it. Each refreshes the scans; approve also the contacts. */
export function useReviewBusinessCard() {
  const queryClient = useQueryClient();
  const { userId, workspaceId } = useWorkspaceScope();
  const refreshCards = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.businessCards.all(userId ?? '', workspaceId ?? '') });

  return {
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: CardPatch }) =>
        api.businessCards.update(workspaceId as string, id, patch),
      onSuccess: refreshCards,
    }),
    approve: useMutation({
      mutationFn: (id: string) => api.businessCards.approve(workspaceId as string, id),
      onSuccess: async () => {
        await refreshCards();
        await queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all(userId ?? '', workspaceId ?? '') });
      },
    }),
    reject: useMutation({
      mutationFn: (id: string) => api.businessCards.reject(workspaceId as string, id),
      onSuccess: refreshCards,
    }),
  };
}
