import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

/** The folders and files at `path` (relative to the FileForge folder). Only runs while OneDrive is connected. */
export function useGetOneDriveItems(workspaceId: string | undefined, path: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.oneDrive.items(workspaceId ?? '', path),
    queryFn: ({ signal }) => api.storage.oneDrive.listItems(workspaceId as string, path, { signal }),
    enabled: enabled && workspaceId !== undefined,
    retry: false,
  });
}
