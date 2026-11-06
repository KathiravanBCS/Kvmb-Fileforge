import { Alert, Button, Paper } from '@mantine/core';
import { IconAlertTriangle, IconCloud, IconLock, IconUsers } from '@tabler/icons-react';

import { EmptyState } from '@/components/feedback/EmptyState';
import type { OneDriveStatus } from '../types';

interface ConnectionPanelProps {
  status: Exclude<OneDriveStatus['status'], 'connected'>;
  /** Only workspace owners and admins may connect storage. */
  canConnect: boolean;
  connecting: boolean;
  connectError: string | null;
  onConnect: () => void;
  onSignInAgain: () => void;
  onRetry: () => void;
}

/** What the File Manager shows until OneDrive is usable. */
export function ConnectionPanel({ status, canConnect, connecting, connectError, onConnect, onSignInAgain, onRetry }: ConnectionPanelProps) {
  const connectButton = canConnect ? (
    <Button leftSection={<IconCloud size={16} />} onClick={onConnect} loading={connecting}>
      Connect OneDrive
    </Button>
  ) : undefined;

  return (
    <Paper withBorder p="xl">
      {connectError && (
        <Alert color="red" variant="light" mb="md" role="alert">
          {connectError}
        </Alert>
      )}

      {status === 'not_connected' && (
        <EmptyState
          icon={IconCloud}
          title="Connect your OneDrive"
          description={
            canConnect
              ? 'FileForge keeps your files in a “FileForge” folder in your OneDrive. It only ever uses that folder, and asks for your permission first.'
              : 'Ask a workspace owner or administrator to connect OneDrive for this workspace.'
          }
          action={connectButton}
        />
      )}

      {status === 'consent_required' && (
        <EmptyState
          icon={IconLock}
          title="Permission needed"
          description="OneDrive is set up, but FileForge needs your permission to use it in this session."
          action={connectButton ?? <Button onClick={onRetry}>Check again</Button>}
        />
      )}

      {status === 'reauth_required' && (
        <EmptyState
          icon={IconLock}
          title="Sign in again"
          description="Your Microsoft session has expired. Sign in again to keep using OneDrive."
          action={<Button onClick={onSignInAgain}>Sign in with Microsoft</Button>}
        />
      )}

      {status === 'owned_by_other_user' && (
        <EmptyState
          icon={IconUsers}
          title="OneDrive belongs to another member"
          description="This workspace uses another member’s OneDrive, so only that person can browse it."
        />
      )}

      {status === 'error' && (
        <EmptyState
          icon={IconAlertTriangle}
          title="OneDrive needs attention"
          description="The OneDrive connection could not be used. Connect it again to repair it."
          action={connectButton ?? <Button onClick={onRetry}>Try again</Button>}
        />
      )}
    </Paper>
  );
}
