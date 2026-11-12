import { useQuery } from '@tanstack/react-query';

import { useWorkspaceScope } from '@/features/workspaces/hooks/useWorkspaceScope';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useGetContact(id: string | null) {
  const { userId, workspaceId, ready } = useWorkspaceScope();
  return useQuery({
    queryKey: queryKeys.contacts.contact(userId ?? '', workspaceId ?? '', id ?? ''),
    queryFn: ({ signal }) => api.contacts.get(workspaceId as string, id as string, { signal }),
    enabled: ready && id !== null,
    retry: false,
  });
}
