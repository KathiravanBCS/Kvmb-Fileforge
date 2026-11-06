import { useMutation } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { saveBlob } from '@/lib/utils/download';

/**
 * Downloads through the API (the session cookie authorizes it) and hands the bytes to the browser as a file.
 * `name` is the name already shown in the list: Content-Disposition is not readable cross-origin.
 */
export function useDownloadFile(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: async (input: { path: string; name: string }) => {
      saveBlob(await api.storage.oneDrive.download(workspaceId as string, input.path), input.name);
    },
  });
}
