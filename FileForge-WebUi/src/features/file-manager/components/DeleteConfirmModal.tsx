import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core';

import type { OneDriveItem } from '../types';

interface DeleteConfirmModalProps {
  item: OneDriveItem | null;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** Deleting is destructive, so it always needs an explicit confirmation naming the file. */
export function DeleteConfirmModal({ item, pending, error, onConfirm, onClose }: DeleteConfirmModalProps) {
  return (
    <Modal opened={item !== null} onClose={onClose} title="Delete file?" centered>
      <Stack>
        <Text size="sm">
          <strong>{item?.name}</strong> will be moved to the OneDrive recycle bin. You can restore it from there.
        </Text>
        {error && (
          <Alert color="red" variant="light" role="alert">
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={pending} data-autofocus>
            Cancel
          </Button>
          <Button color="red" onClick={onConfirm} loading={pending}>
            Delete
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
