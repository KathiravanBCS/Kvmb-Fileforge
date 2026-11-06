import { useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Divider, Drawer, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconRefresh } from '@tabler/icons-react';

import { useGetRecoveryItem } from '../api/useGetRecovery';
import { useDismissRecovery, useRetryRecovery } from '../api/useRecoveryActions';
import { actorLabel, describeOutcome, eventLabel, formatWhen, problemLabel, STATE_BADGE } from '../recovery';
import type { RecoveryItem } from '../types';
import { describeError, formatBytes, ownerLabel } from '../utils';

interface RecoveryDrawerProps {
  /** The file to show; null = closed. */
  id: string | null;
  onClose: () => void;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" align="flex-start" gap="md">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text size="sm" ta="right" style={{ wordBreak: 'break-word' }}>
        {children}
      </Text>
    </Group>
  );
}

/** One file: what happened, what is planned, its history, and the two actions an administrator has. */
export function RecoveryDrawer({ id, onClose }: RecoveryDrawerProps) {
  return (
    <Drawer opened={id !== null} onClose={onClose} position="right" title="Recovery details" size="md">
      {id && <Details key={id} id={id} />}
    </Drawer>
  );
}

function Details({ id }: { id: string }) {
  const detail = useGetRecoveryItem(id);
  const retry = useRetryRecovery();
  const dismiss = useDismissRecovery();
  const [confirming, setConfirming] = useState<'retry' | 'dismiss' | null>(null);

  if (detail.isPending) return <Loader aria-label="Loading the details" />;
  if (detail.isError) {
    return (
      <Alert color="red" variant="light" role="alert" title="Couldn’t load the details">
        {describeError(detail.error)}
        <Group mt="sm">
          <Button size="xs" variant="default" onClick={() => void detail.refetch()}>
            Try again
          </Button>
        </Group>
      </Alert>
    );
  }

  const { item, events } = detail.data;
  const badge = STATE_BADGE[item.state];
  const busy = retry.isPending || dismiss.isPending || item.inProgress;
  const failure = retry.isError ? describeError(retry.error) : dismiss.isError ? describeError(dismiss.error) : null;

  const runRetry = () =>
    retry.mutate(item.id, {
      onSuccess: ({ outcome, item: after }) => {
        notifications.show({ ...describeOutcome(outcome, after), autoClose: outcome === 'repaired' ? 5000 : false });
        setConfirming(null);
      },
      onError: () => setConfirming(null),
    });
  const runDismiss = () =>
    dismiss.mutate(item.id, {
      onSuccess: () => {
        notifications.show({ color: 'green', title: 'Marked as reviewed', message: `${item.fileName} was taken out of the review queue.` });
        setConfirming(null);
      },
      onError: () => setConfirming(null),
    });

  return (
    <Stack gap="md">
      <Text fw={600} style={{ wordBreak: 'break-word' }}>
        {item.fileName}
      </Text>

      <Alert color={badge.color} variant="light" role="note" title={`${problemLabel(item.status)} · ${badge.label}`}>
        {item.explanation}
      </Alert>

      {failure && (
        <Alert color="red" variant="light" role="alert">
          {failure}
        </Alert>
      )}

      <Stack gap="xs">
        <Row label="Owner">{ownerLabel(item.owner ?? undefined)}</Row>
        {item.owner && <Row label="Owner e-mail">{item.owner.email}</Row>}
        <Row label="Size">{formatBytes(item.sizeBytes)}</Row>
        {item.pendingSizeBytes !== null && <Row label="Replacement size">{formatBytes(item.pendingSizeBytes)}</Row>}
        <Row label="Started">{formatWhen(item.createdAt)}</Row>
        <Row label="Last changed">{formatWhen(item.updatedAt)}</Row>
        <Row label="Attempts">
          {item.attempts} of {item.maxAttempts}
        </Row>
        <Row label="Last checked">{formatWhen(item.lastRecoveryAt)}</Row>
        {item.state !== 'needs_review' && <Row label="Next attempt">{formatWhen(item.nextRecoveryAt)}</Row>}
        {item.lastErrorCode && <Row label="Last error">{item.lastErrorCode}</Row>}
      </Stack>

      <Divider />
      <Group gap="xs">
        <Button leftSection={<IconRefresh size={14} />} size="xs" disabled={busy} onClick={() => setConfirming('retry')}>
          Retry now
        </Button>
        {item.state === 'needs_review' && (
          <Button leftSection={<IconCheck size={14} />} size="xs" variant="default" disabled={busy} onClick={() => setConfirming('dismiss')}>
            Mark as reviewed
          </Button>
        )}
      </Group>
      {item.inProgress && (
        <Text size="xs" c="dimmed">
          A worker is on this file right now.
        </Text>
      )}

      <Divider label="History" labelPosition="left" />
      {events.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nothing has been recorded for this file yet.
        </Text>
      ) : (
        <Stack gap="xs" component="ul" m={0} p={0} style={{ listStyle: 'none' }} aria-label="Recovery history">
          {events.map((event, index) => (
            <li key={`${event.occurredAt}-${index}`}>
              <Group justify="space-between" wrap="nowrap" gap="md">
                <Text size="sm">{eventLabel(event.action)}</Text>
                <Badge variant="light" color="gray" size="sm">
                  {actorLabel(event.actorType)}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                {formatWhen(event.occurredAt)}
              </Text>
            </li>
          ))}
        </Stack>
      )}

      <ConfirmRetry item={item} opened={confirming === 'retry'} loading={retry.isPending} onConfirm={runRetry} onCancel={() => setConfirming(null)} />
      <ConfirmDismiss item={item} opened={confirming === 'dismiss'} loading={dismiss.isPending} onConfirm={runDismiss} onCancel={() => setConfirming(null)} />
    </Stack>
  );
}

interface ConfirmProps {
  item: RecoveryItem;
  opened: boolean;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmRetry({ item, opened, loading, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal opened={opened} onClose={onCancel} title="Retry recovery now?" centered closeOnClickOutside={false}>
      <Stack>
        <Text size="sm">
          This runs the recovery checks for <strong>{item.fileName}</strong> immediately and acts on what OneDrive holds: it can finish or undo the
          interrupted operation.
        </Text>
        <Text size="sm" c="dimmed">
          Nothing is deleted from OneDrive except finishing a delete that was already requested. Your action is recorded in the audit trail.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={onConfirm} loading={loading}>
            Retry now
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function ConfirmDismiss({ item, opened, loading, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal opened={opened} onClose={onCancel} title="Mark as reviewed?" centered closeOnClickOutside={false}>
      <Stack>
        <Text size="sm">
          <strong>{item.fileName}</strong> will be taken out of the review queue and left exactly as it is. Automatic recovery will not look at it
          again.
        </Text>
        <Text size="sm" c="dimmed">
          Nothing is changed in OneDrive or in the file’s record. Your action is recorded in the audit trail.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={onConfirm} loading={loading}>
            Mark as reviewed
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
