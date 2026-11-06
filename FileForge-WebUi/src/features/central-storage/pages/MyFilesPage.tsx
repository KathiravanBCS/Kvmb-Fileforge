import { Alert, Button, Grid, Loader, Paper, Stack } from '@mantine/core';
import { IconAlertTriangle, IconFolderOpen, IconLock, IconRefresh, IconSearchOff } from '@tabler/icons-react';

import { AppDataGridView, ColumnManager, DensityMenu, GlobalSearch } from '@/components/data/AppDataGrid';
import { EmptyState } from '@/components/feedback/EmptyState';
import { PageContainer } from '@/components/layout/PageContainer';
import { useGetCapabilities } from '../api/useGetCapabilities';
import { useGetCentralFiles } from '../api/useGetCentralFiles';
import { useGetCentralUsage } from '../api/useGetCentralUsage';
import { ActiveFilters } from '../components/ActiveFilters';
import { CentralFilesGrid } from '../components/CentralFilesGrid';
import { FileDropzone } from '../components/FileDropzone';
import { FileTypeFilter } from '../components/FileTypeFilter';
import { StorageUnavailableAlert } from '../components/StorageUnavailableAlert';
import { StorageUsageCard } from '../components/StorageUsageCard';
import { UploadQueue } from '../components/UploadQueue';
import { useCentralFileActions } from '../hooks/useCentralFileActions';
import { useCentralFileColumns } from '../hooks/useCentralFileColumns';
import { useCurrentUserId } from '../hooks/useCurrentUserId';
import { hasActiveFilters, useFileListState } from '../hooks/useFileListState';
import { useUploadCentralFiles } from '../hooks/useUploadCentralFiles';

/** Used until the API has told us its limit (the API enforces its own regardless). */
const FALLBACK_MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * "My Files": the signed-in user's own files in central storage. Every request acts as the signed-in user on the server, so
 * this page can only ever show and change their files. There is no OneDrive connection here: storage is run by an administrator.
 */
export function MyFilesPage() {
  const userId = useCurrentUserId();
  if (!userId) {
    return (
      <PageContainer title="My Files">
        <EmptyState icon={IconLock} title="Sign in to see your files" description="Your files are available once you are signed in." />
      </PageContainer>
    );
  }
  return <MyFiles />;
}

function MyFiles() {
  const capabilities = useGetCapabilities();
  const { state, change, clearFilters } = useFileListState();
  const files = useGetCentralFiles('me', state);
  const usage = useGetCentralUsage();

  const maxFileBytes = capabilities.data?.maxFileBytes ?? FALLBACK_MAX_FILE_BYTES;
  // Until the API says storage is usable, nothing that needs OneDrive is offered (no optimistic "it will probably work").
  const available = capabilities.data?.available === true;
  const contentDisabled = !available;

  const uploads = useUploadCentralFiles({ scope: 'me', maxFileBytes });
  const { actions, dialogs } = useCentralFileActions({ scope: 'me', contentDisabled, maxFileBytes });
  const columns = useCentralFileColumns({ showOwner: false, contentDisabled, actions });

  const filtered = hasActiveFilters(state);
  const empty = filtered ? (
    <EmptyState
      icon={IconSearchOff}
      title="No matching files"
      description="Nothing matches your search or filters."
      action={<Button variant="light" onClick={clearFilters}>Clear all filters</Button>}
    />
  ) : (
    <EmptyState
      icon={IconFolderOpen}
      title="No files yet"
      description={available ? 'Drag files onto the upload area above to add your first file.' : 'Files you upload will appear here once storage is available.'}
    />
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
      ariaLabel="My files"
      empty={empty}
    >
      <PageContainer
        title="My Files"
        description="Your files, stored securely. Only you can see them."
        topActions={<GlobalSearch />}
        actions={
          <Button
            variant="default"
            size="xs"
            leftSection={<IconRefresh size={14} />}
            loading={files.isFetching && !files.isPending}
            onClick={() => void files.refetch()}
          >
            Refresh
          </Button>
        }
        toolbar={<FileTypeFilter value={state.type} onChange={(type) => change({ type })} />}
        toolbarEnd={
          <>
            <ColumnManager />
            <DensityMenu />
          </>
        }
      >
        <Stack gap="md">
          {capabilities.isPending && <Loader size="sm" aria-label="Checking storage" />}
          {capabilities.isError && (
            <Alert color="red" variant="light" role="alert" icon={<IconAlertTriangle size={18} />} title="We couldn’t check whether storage is available">
              {capabilities.error.message}{' '}
              <Button size="compact-sm" variant="light" onClick={() => void capabilities.refetch()}>
                Try again
              </Button>
            </Alert>
          )}
          {capabilities.isSuccess && !available && <StorageUnavailableAlert isAdmin={capabilities.data.isSystemAdmin} />}

          <Grid gap="md" align="stretch">
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <StorageUsageCard
                label="Your storage"
                fileCount={usage.data?.fileCount}
                totalBytes={usage.data?.totalBytes}
                loading={usage.isPending}
                error={usage.isError}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 8 }}>
              <FileDropzone
                maxFileBytes={maxFileBytes}
                disabled={contentDisabled}
                disabledReason="Uploads are unavailable until storage is connected."
                onFiles={uploads.add}
              />
            </Grid.Col>
          </Grid>

          <UploadQueue items={uploads.items} onCancel={uploads.cancel} onClear={uploads.clearFinished} />
          <ActiveFilters state={state} onChange={change} onClear={clearFilters} />

          <Paper withBorder p={0}>
            <AppDataGridView />
          </Paper>
        </Stack>
      </PageContainer>
      {dialogs}
    </CentralFilesGrid>
  );
}
