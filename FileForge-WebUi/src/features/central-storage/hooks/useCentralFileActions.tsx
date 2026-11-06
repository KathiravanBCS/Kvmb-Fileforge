import { useMemo, useState } from 'react';
import { notifications } from '@mantine/notifications';

import { useDownloadCentralFile } from '../api/useDownloadCentralFile';
import { FileDeleteModal } from '../components/FileDeleteModal';
import { FileDetailsDrawer } from '../components/FileDetailsDrawer';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { FileRenameModal } from '../components/FileRenameModal';
import { ReplaceFileModal } from '../components/ReplaceFileModal';
import type { CentralFile, CentralScope } from '../types';
import { describeError } from '../utils';
import type { FileActions } from './useCentralFileColumns';
import { useCurrentUserId } from './useCurrentUserId';

interface Options {
  scope: CentralScope;
  contentDisabled: boolean;
  maxFileBytes: number;
}

/**
 * Everything a file row can do (details, preview, download, rename, replace, delete) and the dialogs behind it, shared by
 * "My Files" and "Admin Storage". `actions` goes to the table's columns; render `dialogs` once anywhere on the page.
 */
export function useCentralFileActions({ scope, contentDisabled, maxFileBytes }: Options) {
  const userId = useCurrentUserId();
  const download = useDownloadCentralFile(scope);
  const [details, setDetails] = useState<CentralFile | null>(null);
  const [previewing, setPreviewing] = useState<CentralFile | null>(null);
  const [renaming, setRenaming] = useState<CentralFile | null>(null);
  const [replacing, setReplacing] = useState<CentralFile | null>(null);
  const [deleting, setDeleting] = useState<CentralFile | null>(null);

  const { mutate: downloadFile } = download;
  const actions = useMemo<FileActions>(
    () => ({
      onOpen: setDetails,
      onPreview: setPreviewing,
      onDownload: (file) =>
        downloadFile(
          { id: file.id, name: file.name },
          {
            onError: (error) =>
              notifications.show({ color: 'red', title: `Couldn’t download ${file.name}`, message: describeError(error), autoClose: false }),
          },
        ),
      onRename: setRenaming,
      onReplace: setReplacing,
      onDelete: setDeleting,
    }),
    [downloadFile],
  );

  // An administrator acting on somebody else's file is recorded in the audit trail: the dialogs say so.
  const audited = (file: CentralFile | null) => scope === 'admin' && file !== null && file.ownerId !== userId;

  // The drawer shows a snapshot of the file, so an action started from it closes it first (a rename or delete would
  // otherwise leave it showing stale details).
  const fromDrawer = (open: (file: CentralFile) => void) => (file: CentralFile) => {
    setDetails(null);
    open(file);
  };

  const dialogs = (
    <>
      <FileDetailsDrawer
        file={details}
        showOwner={scope === 'admin'}
        contentDisabled={contentDisabled}
        onClose={() => setDetails(null)}
        onPreview={fromDrawer(setPreviewing)}
        onDownload={actions.onDownload}
        onRename={fromDrawer(setRenaming)}
        onReplace={fromDrawer(setReplacing)}
        onDelete={fromDrawer(setDeleting)}
      />
      <FilePreviewModal scope={scope} file={previewing} onClose={() => setPreviewing(null)} onDownload={actions.onDownload} />
      <FileRenameModal scope={scope} file={renaming} audited={audited(renaming)} onClose={() => setRenaming(null)} />
      <ReplaceFileModal scope={scope} file={replacing} maxFileBytes={maxFileBytes} audited={audited(replacing)} onClose={() => setReplacing(null)} />
      <FileDeleteModal scope={scope} file={deleting} audited={audited(deleting)} onClose={() => setDeleting(null)} />
    </>
  );

  return { actions, dialogs };
}
