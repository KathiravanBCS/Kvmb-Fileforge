import { useState } from 'react';
import { Alert, Anchor, Button, Loader, SegmentedControl, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react';
import { Link, useNavigate } from 'react-router-dom';

import { EmptyState } from '@/components/feedback/EmptyState';
import { PageContainer } from '@/components/layout/PageContainer';
import { useGetRecoveryItems, useGetRecoverySummary } from '../api/useGetRecovery';
import { AdminOnly } from '../components/AdminOnly';
import { RecoveryDrawer } from '../components/RecoveryDrawer';
import { RecoveryTable } from '../components/RecoveryTable';
import { StatCard } from '../components/StatCard';
import { formatWhen } from '../recovery';
import type { RecoveryState } from '../types';
import { describeError } from '../utils';

/**
 * Storage Recovery: uploads, replacements and deletes that did not finish (a crash, a restart, a lost connection), what the
 * server has done about them, and what needs a person. Only rendered for a verified system administrator; the API refuses
 * anyone else on every request and records every action taken here in the audit trail.
 */
export function StorageRecoveryPage() {
  return (
    <AdminOnly>
      <Recovery />
    </AdminOnly>
  );
}

function Recovery() {
  const navigate = useNavigate();
  const [state, setState] = useState<RecoveryState>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const summary = useGetRecoverySummary();
  const items = useGetRecoveryItems(state);

  const counts = summary.data;
  const refresh = () => {
    void summary.refetch();
    void items.refetch();
  };
  const filters: { value: RecoveryState; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'needs_review', label: counts ? `Needs review (${counts.needsReview})` : 'Needs review' },
    { value: 'retrying', label: counts ? `Retrying (${counts.retrying})` : 'Retrying' },
    { value: 'waiting', label: counts ? `Waiting (${counts.waiting})` : 'Waiting' },
  ];

  return (
    <PageContainer
      title="Storage Recovery"
      description="Uploads, replacements and deletes that did not finish, and what is being done about them."
      breadcrumbs={[{ label: 'Admin Storage', onClick: () => navigate('/admin/storage') }, { label: 'Recovery' }]}
      actions={
        <Button variant="default" size="xs" leftSection={<IconRefresh size={14} />} loading={(summary.isFetching || items.isFetching) && !items.isPending} onClick={refresh}>
          Refresh
        </Button>
      }
    >
      <Stack gap="md">
        {counts && !counts.worker.enabled && (
          <Alert color="blue" variant="light" role="note" title="Automatic recovery is off">
            Nothing is repaired automatically. You can still recover a file yourself with “Retry now”. To turn the automatic worker on, set
            CENTRAL_RECOVERY_ENABLED=true on the server.
          </Alert>
        )}
        {counts && counts.reauthRequired > 0 && (
          <Alert color="yellow" variant="light" role="alert" title="OneDrive needs to be reconnected">
            {counts.reauthRequired === 1 ? '1 file is' : `${counts.reauthRequired} files are`} waiting for the central OneDrive.{' '}
            <Anchor component={Link} to="/admin/storage/settings">
              Open Storage Settings
            </Anchor>
          </Alert>
        )}
        {summary.isError && (
          <Alert color="red" variant="light" role="alert" title="The summary couldn’t be loaded">
            {describeError(summary.error)}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="md">
          <StatCard label="Needs review" value={counts && String(counts.needsReview)} hint="Waiting for you" loading={summary.isPending} error={summary.isError} />
          <StatCard label="Retrying" value={counts && String(counts.retrying)} hint="Will be tried again" loading={summary.isPending} error={summary.isError} />
          <StatCard label="Waiting" value={counts && String(counts.waiting)} hint="Not examined yet" loading={summary.isPending} error={summary.isError} />
          <StatCard
            label="Repaired, last 24 h"
            value={counts && String(counts.repairedLast24h)}
            hint={counts ? `Last check: ${formatWhen(counts.lastRecoveryAt)}` : undefined}
            loading={summary.isPending}
            error={summary.isError}
          />
        </SimpleGrid>

        <SegmentedControl
          value={state}
          onChange={(value) => setState(value as RecoveryState)}
          data={filters}
          aria-label="Show"
          style={{ alignSelf: 'flex-start', maxWidth: '100%' }}
        />

        {items.isPending && <Loader aria-label="Loading the files" />}
        {items.isError && (
          <EmptyState
            icon={IconAlertTriangle}
            title="We couldn’t load the list"
            description={describeError(items.error)}
            action={<Button onClick={() => void items.refetch()}>Try again</Button>}
          />
        )}
        {items.isSuccess && (
          <>
            <RecoveryTable items={items.data.items} loading={false} error={null} onRetry={() => void items.refetch()} onOpen={(item) => setOpenId(item.id)} />
            {items.data.total > items.data.items.length && (
              <Text size="xs" c="dimmed">
                Showing the first {items.data.items.length} of {items.data.total}. Handle these and refresh to see the rest.
              </Text>
            )}
          </>
        )}
      </Stack>

      <RecoveryDrawer id={openId} onClose={() => setOpenId(null)} />
    </PageContainer>
  );
}
