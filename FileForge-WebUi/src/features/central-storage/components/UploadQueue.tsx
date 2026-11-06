import { ActionIcon, Badge, Button, Group, Paper, Progress, Stack, Text, Tooltip } from '@mantine/core';
import { IconX } from '@tabler/icons-react';

import type { UploadItem, UploadStatus } from '../hooks/useUploadCentralFiles';
import { formatBytes } from '../utils';

interface UploadQueueProps {
  items: UploadItem[];
  onCancel: (id: string) => void;
  onClear: () => void;
}

const STATUS: Record<UploadStatus, { label: string; color: string }> = {
  queued: { label: 'Waiting', color: 'gray' },
  uploading: { label: 'Uploading', color: 'blue' },
  done: { label: 'Uploaded', color: 'green' },
  failed: { label: 'Failed', color: 'red' },
  cancelled: { label: 'Cancelled', color: 'gray' },
};

/** The uploads of this session: progress while sending, then the result of each file. */
export function UploadQueue({ items, onCancel, onClear }: UploadQueueProps) {
  if (items.length === 0) return null;
  const finished = items.some((item) => item.status === 'done' || item.status === 'failed' || item.status === 'cancelled');

  return (
    <Paper withBorder p="sm" aria-label="Uploads" role="region">
      <Stack gap="xs">
        {items.map((item) => {
          const active = item.status === 'queued' || item.status === 'uploading';
          const percent = Math.round(item.progress * 100);
          // Everything has been sent but the server is still saving it to storage: say so instead of a stuck 100%.
          const saving = item.status === 'uploading' && item.progress >= 1;
          return (
            <Stack key={item.id} gap={4}>
              <Group justify="space-between" wrap="nowrap" gap="xs">
                <Text size="sm" truncate flex={1}>
                  {item.name}{' '}
                  <Text span size="xs" c="dimmed">
                    {formatBytes(item.size)}
                  </Text>
                </Text>
                <Badge variant="light" color={STATUS[item.status].color} size="sm">
                  {saving ? 'Saving…' : item.status === 'uploading' ? `${percent}%` : STATUS[item.status].label}
                </Badge>
                {active && (
                  <Tooltip label="Cancel upload">
                    <ActionIcon variant="subtle" color="gray" size="sm" aria-label={`Cancel upload of ${item.name}`} onClick={() => onCancel(item.id)}>
                      <IconX size={14} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </Group>
              {item.status === 'uploading' && (
                <Progress
                  value={percent}
                  size="xs"
                  animated={saving}
                  aria-label={`Upload progress of ${item.name}`}
                />
              )}
              {active && item.notice && (
                <Text size="xs" c="dimmed" role="status">
                  {item.notice}
                </Text>
              )}
              {item.status === 'failed' && item.error && (
                <Text size="xs" c="red" role="alert">
                  {item.error}
                </Text>
              )}
            </Stack>
          );
        })}
        {finished && (
          <Group justify="flex-end">
            <Button variant="subtle" size="compact-xs" onClick={onClear}>
              Clear finished
            </Button>
          </Group>
        )}
      </Stack>
    </Paper>
  );
}
