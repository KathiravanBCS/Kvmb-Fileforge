import type { ReactNode } from 'react';
import { Alert, Badge, Button, Group, Paper, Progress, Stack, Text, Title } from '@mantine/core';
import { IconCloud, IconHeartRateMonitor, IconRefresh } from '@tabler/icons-react';
import dayjs from 'dayjs';

import { CONNECTION_STATUS_TEXT } from '../messages';
import type { ConnectionStatus } from '../types';
import { formatBytes } from '../utils';

interface CentralStorageConnectionCardProps {
  status: ConnectionStatus;
  onConnect: () => void;
  connecting: boolean;
  connectError: string | null;
  onVerify: () => void;
  verifying: boolean;
  verifyError: string | null;
}

const formatDate = (value: string | null) => (value ? dayjs(value).format('D MMM YYYY, HH:mm') : 'Never');

function Detail({ label, children }: { label: string; children: ReactNode }) {
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

/**
 * The central OneDrive connection: its state, the connected Microsoft account, health and quota, and the actions that fix it.
 * It only ever shows what the API returns, which contains no token, no OneDrive id and no encrypted data.
 */
export function CentralStorageConnectionCard({ status, onConnect, connecting, connectError, onVerify, verifying, verifyError }: CentralStorageConnectionCardProps) {
  const text = CONNECTION_STATUS_TEXT[status.status] ?? { label: status.status, color: 'gray', hint: '' };
  const notConnected = status.status === 'not_connected';
  const needsReconnect = status.status === 'reauth_required' || status.status === 'revoked' || status.status === 'error';
  const quota = status.quota;
  const quotaPercent = quota && quota.total && quota.used !== null ? Math.min(100, Math.round((quota.used / quota.total) * 100)) : null;

  return (
    <Paper withBorder p="lg">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={4}>
            <Group gap="sm">
              <Title order={3} size="h4">
                Central OneDrive
              </Title>
              <Badge color={text.color} variant="light" aria-label={`Connection status: ${text.label}`}>
                {text.label}
              </Badge>
            </Group>
            <Text size="sm" c="dimmed">
              {text.hint}
            </Text>
          </Stack>
        </Group>

        {connectError && (
          <Alert color="red" variant="light" role="alert" title="Couldn’t start the connection">
            {connectError}
          </Alert>
        )}
        {verifyError && (
          <Alert color="red" variant="light" role="alert" title="The connection check failed">
            {verifyError}
          </Alert>
        )}
        {needsReconnect && (
          <Alert color="red" variant="light" role="alert" title="Uploads and downloads are unavailable">
            Until the connection is restored, nobody can upload, open or delete files.
          </Alert>
        )}

        {!notConnected && (
          <Stack gap="xs">
            <Detail label="Microsoft account">
              {status.account?.displayName ?? status.account?.email ?? 'Unknown'}
              {status.account?.displayName && status.account.email ? ` (${status.account.email})` : ''}
            </Detail>
            {status.account && <Detail label="Account type">{status.account.accountType === 'personal' ? 'Personal Microsoft account' : status.account.accountType}</Detail>}
            <Detail label="Storage folder">{status.rootFolderPath ?? '—'}</Detail>
            <Detail label="Connected">{formatDate(status.lastAuthAt)}</Detail>
            <Detail label="Last checked">{formatDate(status.lastVerifiedAt)}</Detail>
            {status.lastErrorCode && <Detail label="Last problem">{status.lastErrorCode}</Detail>}
          </Stack>
        )}

        {quota && (
          <Stack gap={4}>
            <Group justify="space-between">
              <Text size="sm" fw={500}>
                OneDrive storage
              </Text>
              <Text size="sm" c="dimmed">
                {quota.used !== null ? formatBytes(quota.used) : '—'} of {quota.total !== null ? formatBytes(quota.total) : '—'} used
                {quota.remaining !== null ? ` · ${formatBytes(quota.remaining)} free` : ''}
              </Text>
            </Group>
            {quotaPercent !== null && (
              <Progress value={quotaPercent} color={quotaPercent >= 90 ? 'red' : quotaPercent >= 75 ? 'yellow' : undefined} aria-label="OneDrive storage used" />
            )}
          </Stack>
        )}
        {!notConnected && !quota && status.status === 'connected' && (
          <Text size="sm" c="dimmed">
            Storage figures appear after “Check connection”.
          </Text>
        )}

        <Group gap="xs">
          {(notConnected || needsReconnect) && (
            <Button leftSection={<IconCloud size={16} />} onClick={onConnect} loading={connecting}>
              {notConnected ? 'Connect OneDrive' : 'Reconnect OneDrive'}
            </Button>
          )}
          {!notConnected && (
            <Button variant="default" leftSection={<IconHeartRateMonitor size={16} />} onClick={onVerify} loading={verifying}>
              Check connection
            </Button>
          )}
          {status.status === 'connected' && (
            <Button variant="subtle" leftSection={<IconRefresh size={16} />} onClick={onConnect} loading={connecting}>
              Reconnect
            </Button>
          )}
        </Group>

        <Alert color="blue" variant="light" title="What connecting does" role="note">
          All users’ files are stored in a “FileForge-Central” folder of this Microsoft account, separate from the personal File
          Manager. You sign in with Microsoft and approve access to OneDrive files; FileForge keeps the access securely on the server
          and never shows it in the browser. Each user only sees their own files in FileForge, but whoever owns this OneDrive account
          can open the folder in OneDrive directly. Only the account you are signed in with can be connected.
        </Alert>
      </Stack>
    </Paper>
  );
}
