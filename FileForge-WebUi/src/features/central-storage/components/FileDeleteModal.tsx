import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { useDeleteCentralFile } from '../api/useDeleteCentralFile';
import type { CentralFile, CentralScope } from '../types';
import { describeError, ownerLabel } from '../utils';

interface FileDeleteModalProps {
  scope: CentralScope;
  file: CentralFile | null;
  /** True when an administrator deletes somebody else's file. */
  audited: boolean;
  onClose: () => void;
}

/** Deleting is destructive, so it always needs an explicit confirmation that names the file (and its owner, for administrators). */
export function FileDeleteModal({ scope, file, audited, onClose }: FileDeleteModalProps) {
  return (
    <Modal opened={file !== null} onClose={onClose} title="Delete file?" centered>
      {file && <DeleteBody key={file.id} scope={scope} file={file} audited={audited} onClose={onClose} />}
    </Modal>
  );
}

function DeleteBody({ scope, file, audited, onClose }: Omit<FileDeleteModalProps, 'file'> & { file: CentralFile }) {
  const remove = useDeleteCentralFile(scope);

  return (
    <Stack>
      <Text size="sm">
        <strong>{file.name}</strong>
        {audited && file.owner ? <> (owned by {ownerLabel(file.owner)})</> : null} will be deleted from storage. It moves to the
        OneDrive recycle bin, so only an administrator can still get it back.
      </Text>
      {audited && (
        <Alert color="yellow" variant="light" role="note">
          This is another user’s file. Deleting it is recorded in the audit trail.
        </Alert>
      )}
      {remove.isError && (
        <Alert color="red" variant="light" role="alert">
          {describeError(remove.error)}
        </Alert>
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose} disabled={remove.isPending} data-autofocus>
          Cancel
        </Button>
        <Button
          color="red"
          loading={remove.isPending}
          onClick={() =>
            remove.mutate(file.id, {
              onSuccess: () => {
                notifications.show({ color: 'green', title: 'File deleted', message: audited ? `${file.name} · recorded in the audit trail.` : file.name });
                onClose();
              },
            })
          }
        >
          Delete
        </Button>
      </Group>
    </Stack>
  );
}
