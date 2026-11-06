import { useState } from 'react';
import { Alert, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { useRenameCentralFile } from '../api/useRenameCentralFile';
import type { CentralFile, CentralScope } from '../types';
import { describeError, validateRename } from '../utils';

interface FileRenameModalProps {
  scope: CentralScope;
  file: CentralFile | null;
  /** True when an administrator renames somebody else's file. */
  audited: boolean;
  onClose: () => void;
}

export function FileRenameModal({ scope, file, audited, onClose }: FileRenameModalProps) {
  return (
    <Modal opened={file !== null} onClose={onClose} title="Rename file" centered>
      {/* Keyed by id so the field restarts from the current name each time a different file is chosen. */}
      {file && <RenameForm key={file.id} scope={scope} file={file} audited={audited} onClose={onClose} />}
    </Modal>
  );
}

function RenameForm({ scope, file, audited, onClose }: Omit<FileRenameModalProps, 'file'> & { file: CentralFile }) {
  const rename = useRenameCentralFile(scope);
  const [name, setName] = useState(file.name);
  const [touched, setTouched] = useState(false);
  const invalid = validateRename(name, file.name);
  const unchanged = name === file.name;

  const submit = () => {
    setTouched(true);
    if (invalid || unchanged) return;
    rename.mutate(
      { id: file.id, name },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', title: 'File renamed', message: audited ? `${name} · recorded in the audit trail.` : name });
          onClose();
        },
      },
    );
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Stack>
        <TextInput
          label="New name"
          description="The file extension stays the same."
          data-autofocus
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          error={touched ? invalid : null}
          maxLength={255}
        />
        {audited && <Text size="xs" c="dimmed">This is another user’s file. The change is recorded in the audit trail.</Text>}
        {rename.isError && (
          <Alert color="red" variant="light" role="alert">
            {describeError(rename.error)}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={rename.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={rename.isPending} disabled={unchanged}>
            Rename
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
