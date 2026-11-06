import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

/** The workspaces of the signed-in user, each with their role in it. */
export function useGetWorkspaces() {
  return useQuery({
    queryKey: queryKeys.workspaces.list,
    queryFn: ({ signal }) => api.workspaces.list({ signal }),
    retry: false,
  });
}
