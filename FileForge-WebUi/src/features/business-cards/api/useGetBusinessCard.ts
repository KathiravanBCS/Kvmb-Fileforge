import { useQuery } from '@tanstack/react-query';

import { useWorkspaceScope } from '@/features/workspaces/hooks/useWorkspaceScope';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

/** One scan, e.g. when a link opens it directly. */
export function useGetBusinessCard(id: string | null) {
  const { userId, workspaceId, ready } = useWorkspaceScope();
  return useQuery({
    queryKey: queryKeys.businessCards.card(userId ?? '', workspaceId ?? '', id ?? ''),
    queryFn: ({ signal }) => api.businessCards.get(workspaceId as string, id as string, { signal }),
    enabled: ready && id !== null,
    retry: false,
  });
}
