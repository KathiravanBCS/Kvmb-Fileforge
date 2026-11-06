import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Group, Paper, Text } from '@mantine/core';
import { IconCloudUpload } from '@tabler/icons-react';

import { formatBytes } from '../utils';

interface FileDropzoneProps {
  onFiles: (files: File[]) => void;
  /** Storage unavailable, or no target chosen yet. Nothing can be dropped or picked. */
  disabled?: boolean;
  /** Why it is disabled, shown instead of the usual hint. */
  disabledReason?: string;
  maxFileBytes: number;
  /** Allow several files at once. Replacing a file's content takes exactly one. */
  multiple?: boolean;
}

/** Drag files here or click to choose them. Only hands over the files: validation and uploading are the caller's. */
export function FileDropzone({ onFiles, disabled = false, disabledReason, maxFileBytes, multiple = true }: FileDropzoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const choose = () => input.current?.click();
  const deliver = (list: FileList | null) => {
    if (list && list.length > 0) onFiles(multiple ? Array.from(list) : [list[0] as File]);
    if (input.current) input.current.value = ''; // the same file can be chosen again
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) deliver(event.dataTransfer.files);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      choose();
    }
  };

  return (
    <Paper
      withBorder
      p="md"
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={multiple ? 'Upload files: drop them here or press Enter to choose' : 'Choose a file: drop it here or press Enter'}
      onClick={() => !disabled && choose()}
      onKeyDown={onKeyDown}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      style={{
        borderStyle: 'dashed',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        outline: dragging ? '2px solid var(--mantine-primary-color-filled)' : undefined,
        background: dragging ? 'var(--mantine-primary-color-light)' : undefined,
      }}
    >
      <Group justify="center" gap="sm" wrap="nowrap">
        <IconCloudUpload size={28} stroke={1.5} aria-hidden />
        <div>
          <Text size="sm" fw={500}>
            {disabled ? (disabledReason ?? 'Uploads are not available right now.') : multiple ? 'Drag files here, or click to choose' : 'Drag a file here, or click to choose'}
          </Text>
          {!disabled && (
            <Text size="xs" c="dimmed">
              Up to {formatBytes(maxFileBytes)} per file
            </Text>
          )}
        </div>
      </Group>
      <input
        ref={input}
        type="file"
        multiple={multiple}
        hidden
        disabled={disabled}
        aria-label={multiple ? 'Choose files to upload' : 'Choose a file'}
        onChange={(event) => deliver(event.currentTarget.files)}
      />
    </Paper>
  );
}
