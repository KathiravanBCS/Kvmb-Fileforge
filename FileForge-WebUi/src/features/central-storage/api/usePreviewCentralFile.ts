import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useCurrentUserId } from '../hooks/useCurrentUserId';
import type { CentralScope } from '../types';

/**
 * The bytes of a previewable file. File content is private, so it is never kept in the query cache after the preview closes
 * (`gcTime: 0`) and is never refetched in the background.
 */
export function usePreviewCentralFile(scope: CentralScope, fileId: string | null) {
  const userId = useCurrentUserId();
  const files = scope === 'admin' ? api.centralStorage.admin : api.centralStorage.me;

  return useQuery({
    queryKey: queryKeys.centralStorage.preview(userId ?? '', scope, fileId ?? ''),
    queryFn: ({ signal }) => files.preview(fileId as string, { signal }),
    enabled: userId !== undefined && fileId !== null,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
