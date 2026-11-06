import { useState } from 'react';
import { Alert, Button, Group, Modal, Stack } from '@mantine/core';

import { useGetAdminUsers } from '../api/useGetAdminUsers';
import { useUploadCentralFiles } from '../hooks/useUploadCentralFiles';
import { FileDropzone } from './FileDropzone';
import { UploadQueue } from './UploadQueue';
import { UserStorageFilter } from './UserStorageFilter';

interface AdminUploadModalProps {
  opened: boolean;
  maxFileBytes: number;
  /** Storage unavailable: nothing can be uploaded. */
  disabled: boolean;
  /** Pre-select a user (the owner filter that is active on the page). */
  initialUserId?: string;
  onClose: () => void;
}

/** "Upload for user": choose whose storage the files go to, then drop or pick them. The upload is recorded in the audit trail. */
export function AdminUploadModal({ opened, maxFileBytes, disabled, initialUserId, onClose }: AdminUploadModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title="Upload files for a user" size="lg" centered>
      {/* Mounted only while open, so the chosen user and the queue start fresh each time. */}
      {opened && <UploadBody maxFileBytes={maxFileBytes} disabled={disabled} initialUserId={initialUserId} onClose={onClose} />}
    </Modal>
  );
}

function UploadBody({ maxFileBytes, disabled, initialUserId, onClose }: Omit<AdminUploadModalProps, 'opened'>) {
  const users = useGetAdminUsers('');
  const [userId, setUserId] = useState<string | undefined>(initialUserId);
  const uploads = useUploadCentralFiles({ scope: 'admin', targetUserId: userId, maxFileBytes });

  return (
    <Stack>
      <UserStorageFilter
        label="Upload for"
        placeholder="Choose a user"
        required
        users={users.data ?? []}
        loading={users.isPending}
        value={userId}
        onChange={setUserId}
      />
      {users.isError && (
        <Alert color="red" variant="light" role="alert">
          The user list couldn’t be loaded. {users.error.message}
        </Alert>
      )}
      <Alert color="blue" variant="light" role="note">
        The files belong to the chosen user and appear in their “My Files”. The upload is recorded in the audit trail under your
        name.
      </Alert>
      <FileDropzone
        maxFileBytes={maxFileBytes}
        disabled={disabled || !userId}
        disabledReason={disabled ? 'Storage is not available right now.' : 'Choose a user first.'}
        onFiles={uploads.add}
      />
      <UploadQueue items={uploads.items} onCancel={uploads.cancel} onClear={uploads.clearFinished} />
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {uploads.busy ? 'Close (uploads continue)' : 'Done'}
        </Button>
      </Group>
    </Stack>
  );
}
