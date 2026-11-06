import { useMutation } from '@tanstack/react-query';

import { api } from '@/lib/api';

/** Asks the API for the Microsoft consent URL, then sends the browser there. Tokens never pass through the page. */
export function useConnectOneDrive(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: async () => window.location.assign(await api.storage.oneDrive.connect(workspaceId as string)),
  });
}
