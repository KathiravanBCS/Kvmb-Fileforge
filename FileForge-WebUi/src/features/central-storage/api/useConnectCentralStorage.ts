import { useMutation } from '@tanstack/react-query';

import { api } from '@/lib/api';

/**
 * Starts "connect the central OneDrive": the API returns the Microsoft consent URL and the browser goes there. The
 * backend completes the OAuth flow on its redirect and keeps the tokens; this page never sees or stores a token.
 */
export function useConnectCentralStorage() {
  return useMutation({
    mutationFn: () => api.centralStorage.admin.connection.connect(),
    onSuccess: (url) => window.location.assign(url),
  });
}
