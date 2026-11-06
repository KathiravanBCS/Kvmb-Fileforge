import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useCurrentUserId } from '../hooks/useCurrentUserId';

/** After either action the queues, the counts and (a repaired file becomes visible again) the file lists are stale. */
function useRefreshAfterAction() {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.centralStorage.all(userId ?? '') });
}

/** Administrators only: runs the recovery checks for one file now. */
export function useRetryRecovery() {
  const refresh = useRefreshAfterAction();
  return useMutation({
    mutationFn: (id: string) => api.centralStorage.admin.recovery.retry(id),
    onSuccess: refresh,
  });
}

/** Administrators only: "reviewed, leave it as it is". Takes the file out of the review queue; changes nothing in OneDrive. */
export function useDismissRecovery() {
  const refresh = useRefreshAfterAction();
  return useMutation({
    mutationFn: (id: string) => api.centralStorage.admin.recovery.dismiss(id),
    onSuccess: refresh,
  });
}
