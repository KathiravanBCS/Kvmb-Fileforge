import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useCurrentUserId } from '../hooks/useCurrentUserId';
import type { AdminFilesQuery, CentralFilesQuery, CentralScope } from '../types';

/** The own-files API has no owner parameter at all: copy only what it accepts, so a stale owner filter can never reach it. */
function ownFilesQuery(query: AdminFilesQuery): CentralFilesQuery {
  return { page: query.page, pageSize: query.pageSize, search: query.search, type: query.type, sort: query.sort, order: query.order };
}

/**
 * One page of files, searched / filtered / sorted by the server. `me` lists the signed-in user's own files;
 * `admin` lists everyone's (the API refuses anyone who is not a system administrator).
 */
export function useGetCentralFiles(scope: CentralScope, query: AdminFilesQuery, enabled = true) {
  const userId = useCurrentUserId();
  const own = ownFilesQuery(query);

  return useQuery({
    queryKey: queryKeys.centralStorage.files(userId ?? '', scope, scope === 'admin' ? query : own),
    queryFn: ({ signal }) =>
      scope === 'admin' ? api.centralStorage.admin.list(query, { signal }) : api.centralStorage.me.list(own, { signal }),
    enabled: userId !== undefined && enabled,
    // Keep the previous page on screen while the next one loads, so paging and typing do not flash the table empty.
    placeholderData: keepPreviousData,
    retry: false,
  });
}
