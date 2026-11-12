import { useQuery } from '@tanstack/react-query';

import { useWorkspaceScope } from '@/features/workspaces/hooks/useWorkspaceScope';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

/**
 * The photo of a scan. It is private, so it is dropped from the query cache as soon as nothing shows it (`gcTime: 0`) and is
 * never refetched in the background.
 */
export function useBusinessCardImage(id: string | null, side: 'front' | 'back' = 'front') {
  const { userId, workspaceId, ready } = useWorkspaceScope();
  return useQuery({
    queryKey: queryKeys.businessCards.image(userId ?? '', workspaceId ?? '', id ?? '', side),
    queryFn: ({ signal }) => api.businessCards.image(workspaceId as string, id as string, side, { signal }),
    enabled: ready && id !== null,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
