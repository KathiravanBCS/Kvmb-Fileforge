import { ActionIcon, Alert, Badge, Button, Group, Loader, Paper, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconPlus, IconScan, IconTrash } from '@tabler/icons-react';

import type { BatchCard } from '../hooks/useScanBatch';
import { PhotoThumb } from './PhotoThumb';

interface ScanQueueProps {
  cards: BatchCard[];
  running: boolean;
  /** Why the queue stopped on its own (too many scans just now). */
  pausedBecause: string | null;
  onScan: () => void;
  onRemove: (id: string) => void;
  /** Take the back of a card that was added with only a front. */
  onAddBack: (card: BatchCard) => void;
}

const STATUS = {
  queued: { label: 'Waiting', color: 'gray' },
  scanning: { label: 'Reading…', color: 'blue' },
  failed: { label: 'Failed', color: 'red' },
} as const;

/** The cards waiting to be scanned: what will be sent (front and back), and what happened to each. */
export function ScanQueue({ cards, running, pausedBecause, onScan, onRemove, onAddBack }: ScanQueueProps) {
  if (cards.length === 0) return null;
  const retrying = cards.some((card) => card.status === 'failed');

  return (
    <Paper withBorder p="md" aria-label="Cards waiting to be scanned">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>
            {cards.length} {cards.length === 1 ? 'card' : 'cards'} ready to scan
          </Text>
          <Button leftSection={<IconScan size={16} />} onClick={onScan} loading={running}>
            {running ? 'Reading cards…' : retrying ? 'Scan again' : `Scan ${cards.length === 1 ? 'the card' : `all ${cards.length} cards`}`}
          </Button>
        </Group>

        {pausedBecause && (
          <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Paused" role="alert">
            {pausedBecause} The remaining cards are still waiting. Press “Scan again” to continue.
          </Alert>
        )}

        <Stack gap="xs" component="ul" m={0} p={0} style={{ listStyle: 'none' }}>
          {cards.map((card, index) => {
            const status = STATUS[card.status];
            return (
              <Paper key={card.id} component="li" withBorder p="xs">
                <Group justify="space-between" wrap="nowrap" align="center">
                  <Group gap="sm" wrap="nowrap" miw={0}>
                    <Text size="sm" fw={500} w={56}>
                      Card {index + 1}
                    </Text>
                    <PhotoThumb file={card.front} alt={`Front of card ${index + 1}`} />
                    {card.back ? (
                      <PhotoThumb file={card.back} alt={`Back of card ${index + 1}`} />
                    ) : (
                      <Button
                        variant="default"
                        size="xs"
                        leftSection={<IconPlus size={14} />}
                        onClick={() => onAddBack(card)}
                        disabled={card.status === 'scanning'}
                        aria-label={`Add the back of card ${index + 1}`}
                      >
                        Add back
                      </Button>
                    )}
                  </Group>
                  <Group gap="xs" wrap="nowrap">
                    {card.status === 'scanning' && <Loader size="xs" />}
                    <Badge color={status.color} variant="light">
                      {status.label}
                    </Badge>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => onRemove(card.id)}
                      disabled={card.status === 'scanning'}
                      aria-label={`Remove card ${index + 1}`}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </Group>
                {card.error && (
                  <Text size="xs" c="red" mt={4} role="alert">
                    {card.error}
                  </Text>
                )}
              </Paper>
            );
          })}
        </Stack>
      </Stack>
    </Paper>
  );
}
