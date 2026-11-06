import { useCallback, useState } from 'react';
import { Alert, Button, Paper, SimpleGrid, Stack, Tabs } from '@mantine/core';
import { IconFirstAidKit, IconFolderOpen, IconRefresh, IconSearchOff, IconSettings, IconUpload } from '@tabler/icons-react';
import { Link } from 'react-router-dom';

import { AppDataGridView, ColumnManager, DensityMenu, GlobalSearch } from '@/components/data/AppDataGrid';
import { EmptyState } from '@/components/feedback/EmptyState';
import { PageContainer } from '@/components/layout/PageContainer';
import { useGetAdminUsage } from '../api/useGetAdminUsage';
import { useGetAdminUsers } from '../api/useGetAdminUsers';
import { useGetCapabilities } from '../api/useGetCapabilities';
import { useGetCentralFiles } from '../api/useGetCentralFiles';
import { ActiveFilters } from '../components/ActiveFilters';
import { AdminOnly } from '../components/AdminOnly';
import { AdminUploadModal } from '../components/AdminUploadModal';
import { CentralFilesGrid } from '../components/CentralFilesGrid';
import { FileTypeFilter } from '../components/FileTypeFilter';
import { StatCard } from '../components/StatCard';
import { StorageUnavailableAlert } from '../components/StorageUnavailableAlert';
import { StorageUsageCard } from '../components/StorageUsageCard';
import { UserStorageFilter } from '../components/UserStorageFilter';
import { UserUsageTable } from '../components/UserUsageTable';
import { useCentralFileActions } from '../hooks/useCentralFileActions';
import { useCentralFileColumns } from '../hooks/useCentralFileColumns';
import { hasActiveFilters, useFileListState } from '../hooks/useFileListState';

const FALLBACK_MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * Admin Storage: every user's files, usage per user, and the tools to manage them. Only rendered for a verified system
 * administrator (`AdminOnly`), and the API refuses anyone else on every request. Actions on other users' files are
 * recorded in the audit trail by the server; the dialogs say so.
 */
export function AdminStoragePage() {
  return (
    <AdminOnly>
      <AdminStorage />
    </AdminOnly>
  );
}

function AdminStorage() {
  const capabilities = useGetCapabilities();
  const { state, change, clearFilters } = useFileListState();
  const files = useGetCentralFiles('admin', state);
  const usage = useGetAdminUsage();
  const users = useGetAdminUsers('');
  const [tab, setTab] = useState<string | null>('files');
  const [uploading, setUploading] = useState(false);

  const maxFileBytes = capabilities.data?.maxFileBytes ?? FALLBACK_MAX_FILE_BYTES;
  const available = capabilities.data?.available === true;
  const contentDisabled = !available;

  const { actions, dialogs } = useCentralFileActions({ scope: 'admin', contentDisabled, maxFileBytes });
  const columns = useCentralFileColumns({ showOwner: true, contentDisabled, actions });

  const ownerName = users.data?.find((user) => user.id === state.ownerUserId);
  const viewUserFiles = useCallback(
    (userId: string) => {
      change({ ownerUserId: userId });
      setTab('files');
    },
    [change],
  );

  const filtered = hasActiveFilters(state);
  const empty = filtered ? (
    <EmptyState
      icon={IconSearchOff}
      title="No matching files"
      description="Nothing matches the search or filters."
      action={<Button variant="light" onClick={clearFilters}>Clear all filters</Button>}
    />
  ) : (
    <EmptyState icon={IconFolderOpen} title="No files yet" description="Nobody has uploaded a file. Use “Upload for user” to add one." />
  );

  return (
    <CentralFilesGrid
      files={files.data?.items ?? []}
      total={files.data?.total ?? 0}
      loading={files.isPending}
      error={files.error}
      onRetry={() => void files.refetch()}
      state={state}
      onStateChange={change}
      columns={columns}
      ariaLabel="All users’ files"
      empty={empty}
    >
      <PageContainer
        title="Admin Storage"
        description="Every user’s files. Actions on other users’ files are recorded in the audit trail."
        topActions={<GlobalSearch />}
        actions={
          <>
            <Button variant="default" size="xs" leftSection={<IconRefresh size={14} />} loading={files.isFetching && !files.isPending} onClick={() => void files.refetch()}>
              Refresh
            </Button>
            <Button component={Link} to="/admin/storage/recovery" variant="default" size="xs" leftSection={<IconFirstAidKit size={14} />}>
              Recovery
            </Button>
            <Button component={Link} to="/admin/storage/settings" variant="default" size="xs" leftSection={<IconSettings size={14} />}>
              Storage settings
            </Button>
            <Button size="xs" leftSection={<IconUpload size={14} />} disabled={contentDisabled} onClick={() => setUploading(true)}>
              Upload for user
            </Button>
          </>
        }
        toolbar={
          <>
            <UserStorageFilter
              users={users.data ?? []}
              loading={users.isPending}
              value={state.ownerUserId}
              onChange={(ownerUserId) => change({ ownerUserId })}
            />
            <FileTypeFilter value={state.type} onChange={(type) => change({ type })} />
          </>
        }
        toolbarEnd={
          <>
            <ColumnManager />
            <DensityMenu />
          </>
        }
      >
        <Stack gap="md">
          {capabilities.isSuccess && !available && <StorageUnavailableAlert isAdmin />}
          {usage.isError && (
            <Alert color="red" variant="light" role="alert" title="Usage figures couldn’t be loaded">
              {usage.error.message}
            </Alert>
          )}

          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
            <StorageUsageCard
              label="Total storage in use"
              fileCount={usage.data?.total.fileCount}
              totalBytes={usage.data?.total.totalBytes}
              loading={usage.isPending}
              error={usage.isError}
            />
            <StatCard
              label="Users with files"
              value={usage.data ? String(usage.data.perUser.length) : undefined}
              hint={users.data ? `of ${users.data.length} active ${users.data.length === 1 ? 'user' : 'users'}` : undefined}
              loading={usage.isPending}
              error={usage.isError}
            />
          </SimpleGrid>

          <Tabs value={tab} onChange={setTab} keepMounted={false}>
            <Tabs.List>
              <Tabs.Tab value="files">Files</Tabs.Tab>
              <Tabs.Tab value="usage">Usage by user</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="files" pt="md">
              <Stack gap="md">
                <ActiveFilters
                  state={state}
                  ownerName={ownerName ? (ownerName.displayName ?? ownerName.email) : undefined}
                  onChange={change}
                  onClear={clearFilters}
                />
                <Paper withBorder p={0}>
                  <AppDataGridView />
                </Paper>
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="usage" pt="md">
              <Paper withBorder p={0}>
                <UserUsageTable
                  users={usage.data?.perUser ?? []}
                  loading={usage.isPending}
                  error={usage.error}
                  onRetry={() => void usage.refetch()}
                  onViewFiles={viewUserFiles}
                />
              </Paper>
            </Tabs.Panel>
          </Tabs>
        </Stack>
      </PageContainer>

      <AdminUploadModal opened={uploading} maxFileBytes={maxFileBytes} disabled={contentDisabled} initialUserId={state.ownerUserId} onClose={() => setUploading(false)} />
      {dialogs}
    </CentralFilesGrid>
  );
}
