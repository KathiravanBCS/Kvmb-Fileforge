import { useRef, useState } from 'react';
import { Alert, Button, Group, Modal, Progress, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { useReplaceCentralFile } from '../api/useReplaceCentralFile';
import type { CentralFile, CentralScope } from '../types';
import { describeError, extensionOf, formatBytes, isCancelled, isStorageBusy, isUploadLimitReached, validateCentralUpload } from '../utils';
import { FileDropzone } from './FileDropzone';

interface ReplaceFileModalProps {
  scope: CentralScope;
  file: CentralFile | null;
  maxFileBytes: number;
  /** True when an administrator replaces somebody else's file. */
  audited: boolean;
  onClose: () => void;
}

export function ReplaceFileModal({ scope, file, maxFileBytes, audited, onClose }: ReplaceFileModalProps) {
  return (
    <Modal opened={file !== null} onClose={onClose} title="Replace file content" centered closeOnClickOutside={false}>
      {file && <ReplaceBody key={file.id} scope={scope} file={file} maxFileBytes={maxFileBytes} audited={audited} onClose={onClose} />}
    </Modal>
  );
}

function ReplaceBody({ scope, file, maxFileBytes, audited, onClose }: Omit<ReplaceFileModalProps, 'file'> & { file: CentralFile }) {
  const replace = useReplaceCentralFile(scope);
  const [chosen, setChosen] = useState<File | null>(null);
  const [fraction, setFraction] = useState(0);
  // The user pressed "Cancel upload" (so a failure is a cancellation, not an error to show).
  const [cancelRequested, setCancelRequested] = useState(false);
  const controller = useRef<AbortController | null>(null);

  // The new content must be the same kind of file: the name and type stay, and the server checks the bytes match.
  const problem =
    chosen &&
    (validateCentralUpload(chosen, maxFileBytes) ??
      (extensionOf(chosen.name) !== file.extension ? `Choose a .${file.extension ?? ''} file: the type of this file stays the same.` : null));

  const start = () => {
    if (!chosen || problem) return;
    const abort = new AbortController();
    controller.current = abort;
    setFraction(0);
    setCancelRequested(false);
    replace.mutate(
      { id: file.id, file: chosen, onProgress: setFraction, signal: abort.signal },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', title: 'Content replaced', message: audited ? `${file.name} · recorded in the audit trail.` : file.name });
          onClose();
        },
      },
    );
  };

  const cancelled = replace.isError && cancelRequested && isCancelled(replace.error);
  const saving = replace.isPending && fraction >= 1;

  return (
    <Stack>
      <Text size="sm">
        Replace the content of <strong>{file.name}</strong> ({formatBytes(file.size)}). The name and owner stay; the old content is
        overwritten and cannot be brought back from FileForge.
      </Text>
      {audited && (
        <Alert color="yellow" variant="light" role="note">
          This is another user’s file. Replacing it is recorded in the audit trail.
        </Alert>
      )}

      {!replace.isPending && (
        <FileDropzone multiple={false} maxFileBytes={maxFileBytes} onFiles={(files) => setChosen(files[0] ?? null)} />
      )}
      {chosen && (
        <Text size="sm">
          New content: <strong>{chosen.name}</strong> ({formatBytes(chosen.size)})
        </Text>
      )}
      {problem && (
        <Alert color="red" variant="light" role="alert">
          {problem}
        </Alert>
      )}
      {replace.isPending && (
        <Stack gap={4}>
          <Progress value={Math.round(fraction * 100)} animated={saving} aria-label="Replacement progress" />
          <Text size="xs" c="dimmed">
            {saving ? 'Saving to storage…' : `${Math.round(fraction * 100)}%`}
          </Text>
        </Stack>
      )}
      {replace.isError && !cancelled && (
        // Hitting a limit, or a busy server, is not the user's mistake and not a failure of the file: say "wait", not "error".
        <Alert color={isUploadLimitReached(replace.error) || isStorageBusy(replace.error) ? 'yellow' : 'red'} variant="light" role="alert">
          {describeError(replace.error)}
        </Alert>
      )}
      {cancelled && <Text size="sm" c="dimmed">The replacement was cancelled. The file was not changed.</Text>}

      <Group justify="flex-end">
        {replace.isPending ? (
          <Button
            variant="default"
            onClick={() => {
              setCancelRequested(true);
              controller.current?.abort();
            }}
          >
            Cancel upload
          </Button>
        ) : (
          <>
            <Button variant="default" onClick={onClose}>
              Close
            </Button>
            <Button onClick={start} disabled={!chosen || Boolean(problem)}>
              Replace content
            </Button>
          </>
        )}
      </Group>
    </Stack>
  );
}
