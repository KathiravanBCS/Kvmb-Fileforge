import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { useWorkspaceScope } from '@/features/workspaces/hooks/useWorkspaceScope';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { BusinessCardsQuery } from '../types';

/** The signed-in user's own scans in the active workspace (a scan is private to whoever made it). */
export function useGetBusinessCards(query: BusinessCardsQuery) {
  const { userId, workspaceId, ready } = useWorkspaceScope();
  return useQuery({
    queryKey: queryKeys.businessCards.list(userId ?? '', workspaceId ?? '', query),
    queryFn: ({ signal }) => api.businessCards.list(workspaceId as string, query, { signal }),
    enabled: ready,
    placeholderData: keepPreviousData,
  });
}
