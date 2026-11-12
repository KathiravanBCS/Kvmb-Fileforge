import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Group, Paper, Text } from '@mantine/core';
import { IconPhotoPlus } from '@tabler/icons-react';

import { CARD_IMAGE_ACCEPT, MAX_CARD_IMAGE_BYTES } from '../types';

interface CardDropzoneProps {
  /** The photos dropped or chosen (one or many). Validation and queueing are the caller's. */
  onFiles: (files: File[]) => void;
  /** Cannot scan (no permission). Shown instead of the usual hint. */
  disabledReason?: string;
}

/** Drag card photos here, or click to choose several at once. Only hands over the files. */
export function CardDropzone({ onFiles, disabledReason }: CardDropzoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const disabled = disabledReason !== undefined;

  const choose = () => input.current?.click();
  const deliver = (list: FileList | null) => {
    if (list && list.length > 0) onFiles(Array.from(list));
    if (input.current) input.current.value = ''; // the same photos can be chosen again
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
      aria-label="Add card photos: drop them here or press Enter to choose"
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
        <IconPhotoPlus size={28} stroke={1.5} aria-hidden />
        <div>
          <Text size="sm" fw={500}>
            {disabledReason ?? 'Drag card photos here, or click to choose several'}
          </Text>
          {!disabled && (
            <Text size="xs" c="dimmed">
              Each photo becomes the front of a card, used as it is (no cropping). JPG, PNG or WebP, up to{' '}
              {MAX_CARD_IMAGE_BYTES / (1024 * 1024)} MB each.
            </Text>
          )}
        </div>
      </Group>
      <input
        ref={input}
        type="file"
        accept={CARD_IMAGE_ACCEPT}
        multiple
        hidden
        data-testid="card-file-input"
        onChange={(event) => deliver(event.target.files)}
      />
    </Paper>
  );
}
