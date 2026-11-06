import { useMutation } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { saveBlob } from '@/lib/utils/download';
import type { CentralScope } from '../types';

/** Fetches the bytes through the API (never a OneDrive link) and hands them to the browser as a download. Nothing is cached. */
export function useDownloadCentralFile(scope: CentralScope) {
  const files = scope === 'admin' ? api.centralStorage.admin : api.centralStorage.me;

  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      saveBlob(await files.download(id), name);
    },
  });
}
