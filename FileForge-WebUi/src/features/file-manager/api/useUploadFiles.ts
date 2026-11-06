import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { showUploaded, showUploadFailed, showUploading, showUploadProgress } from '../uploadNotifications';
import { validateUpload } from '../utils';

/** Uploads files one after another into `folderPath`. Progress and the result of each file show as a toast. */
export function useUploadFiles(workspaceId: string | undefined, folderPath: string) {
  const queryClient = useQueryClient();
  const nextId = useRef(0);

  const upload = useCallback(
    async (files: File[]) => {
      if (!workspaceId) return;
      const added = files.map((file) => ({ file, id: `upload-${++nextId.current}` }));
      for (const { file, id } of added) showUploading(id, file.name);

      for (const { file, id } of added) {
        const invalid = validateUpload(file);
        if (invalid) {
          showUploadFailed(id, file.name, invalid);
          continue;
        }
        try {
          let shown = 0;
          await api.storage.oneDrive.upload(workspaceId, folderPath, file, {
            onProgress: (fraction) => {
              const percent = Math.round(fraction * 100);
              if (percent !== shown) {
                shown = percent;
                showUploadProgress(id, file.name, percent);
              }
            },
          });
          showUploaded(id, file.name);
        } catch (error) {
          showUploadFailed(id, file.name, error instanceof Error ? error.message : 'The upload failed.');
        }
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.oneDrive.all(workspaceId) });
    },
    [workspaceId, folderPath, queryClient],
  );

  return { upload };
}
