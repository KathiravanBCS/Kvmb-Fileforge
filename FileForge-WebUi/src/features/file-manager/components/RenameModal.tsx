import { useState } from 'react';
import { Alert, Button, Group, Modal, Stack, TextInput } from '@mantine/core';

import { validateFileName } from '../utils';
import type { OneDriveItem } from '../types';

interface RenameModalProps {
  item: OneDriveItem | null;
  pending: boolean;
  /** Server-side failure of the last attempt (e.g. the name already exists). */
  error: string | null;
  onSubmit: (newName: string) => void;
  onClose: () => void;
}

export function RenameModal({ item, pending, error, onSubmit, onClose }: RenameModalProps) {
  return (
    <Modal opened={item !== null} onClose={onClose} title="Rename file" centered>
      {/* Keyed by path so the field restarts from the current name each time a different file is chosen. */}
      {item && <RenameForm key={item.path} item={item} pending={pending} error={error} onSubmit={onSubmit} onClose={onClose} />}
    </Modal>
  );
}

function RenameForm({ item, pending, error, onSubmit, onClose }: RenameModalProps & { item: OneDriveItem }) {
  const [name, setName] = useState(item.name);
  const [touched, setTouched] = useState(false);
  const invalid = validateFileName(name);
  const unchanged = name === item.name;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (!invalid && !unchanged) onSubmit(name);
      }}
    >
      <Stack>
        <TextInput
          label="New name"
          data-autofocus
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          error={touched ? invalid : null}
          maxLength={255}
        />
        {error && (
          <Alert color="red" variant="light" role="alert">
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={unchanged}>
            Rename
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
