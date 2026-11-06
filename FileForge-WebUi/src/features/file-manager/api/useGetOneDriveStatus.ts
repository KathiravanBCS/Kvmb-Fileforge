import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useGetOneDriveStatus(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.oneDrive.status(workspaceId ?? ''),
    queryFn: ({ signal }) => api.storage.oneDrive.getStatus(workspaceId as string, { signal }),
    enabled: workspaceId !== undefined,
    retry: false,
  });
}
