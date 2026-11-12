import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useWorkspaceScope } from '@/features/workspaces/hooks/useWorkspaceScope';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { ContactUpdate } from '../types';

/** Change or delete a contact. Both refresh every contact list and detail. */
export function useContactActions() {
  const queryClient = useQueryClient();
  const { userId, workspaceId } = useWorkspaceScope();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all(userId ?? '', workspaceId ?? '') });

  return {
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: ContactUpdate }) =>
        api.contacts.update(workspaceId as string, id, patch),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.contacts.remove(workspaceId as string, id),
      onSuccess: refresh,
    }),
  };
}
