import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { useWorkspaceScope } from '@/features/workspaces/hooks/useWorkspaceScope';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { ContactsQuery } from '../types';

export function useGetContacts(query: ContactsQuery) {
  const { userId, workspaceId, ready } = useWorkspaceScope();
  return useQuery({
    queryKey: queryKeys.contacts.list(userId ?? '', workspaceId ?? '', query),
    queryFn: ({ signal }) => api.contacts.list(workspaceId as string, query, { signal }),
    enabled: ready,
    placeholderData: keepPreviousData,
  });
}
