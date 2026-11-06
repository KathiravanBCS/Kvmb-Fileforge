import { useCallback, useRef, useState, type DragEvent } from 'react';
import { Alert, Badge, Button, Group, Loader, Paper, Stack } from '@mantine/core';
import { IconAlertTriangle, IconFolders, IconRefresh, IconUpload } from '@tabler/icons-react';
import { useSearchParams } from 'react-router-dom';

import { EmptyState } from '@/components/feedback/EmptyState';
import { PageContainer, type Crumb } from '@/components/layout/PageContainer';
import { useAuth } from '@/features/auth/useAuth';
import { useWorkspaces } from '@/features/workspaces/hooks/useWorkspaces';
import { ApiError } from '@/lib/api-types';
import { useAbility } from '@/lib/casl/hooks';
import { useConnectOneDrive } from '../api/useConnectOneDrive';
import { useDeleteFile } from '../api/useDeleteFile';
import { useDownloadFile } from '../api/useDownloadFile';
import { useGetOneDriveItems } from '../api/useGetOneDriveItems';
import { useGetOneDriveStatus } from '../api/useGetOneDriveStatus';
import { useRenameFile } from '../api/useRenameFile';
import { useUploadFiles } from '../api/useUploadFiles';
import { ConnectionPanel } from '../components/ConnectionPanel';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';
import { FileList } from '../components/FileList';
import { RenameModal } from '../components/RenameModal';
import { getOneDriveNotice } from '../onedriveMessages';
import type { OneDriveItem } from '../types';
import { pathSegments } from '../utils';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Please try again.');

export function FilesPage() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const path = params.get('path') ?? '';
  const notice = getOneDriveNotice(params);

  const workspaces = useWorkspaces();
  const workspace = workspaces.active;
  const status = useGetOneDriveStatus(workspace?.id);
  const connected = status.data?.status === 'connected';
  const items = useGetOneDriveItems(workspace?.id, path, connected);

  const connect = useConnectOneDrive(workspace?.id);
  const rename = useRenameFile(workspace?.id);
  const remove = useDeleteFile(workspace?.id);
  const download = useDownloadFile(workspace?.id);
  const uploads = useUploadFiles(workspace?.id, path);

  const [renaming, setRenaming] = useState<OneDriveItem | null>(null);
  const [deleting, setDeleting] = useState<OneDriveItem | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // A session that ended while the page was open is handled centrally (ApiClient → AuthProvider shows sign-in).

  const navigate = useCallback(
    (nextPath: string) => {
      setParams(nextPath ? { path: nextPath } : {}, { replace: false });
    },
    [setParams],
  );
  // The folder path lives in the page's top breadcrumb: File Manager is the root, then one crumb per folder.
  const segments = pathSegments(path);
  const breadcrumbs: Crumb[] = [
    { label: 'File Manager', onClick: () => navigate('') },
    ...segments.map((segment, index) => ({ label: segment, onClick: () => navigate(segments.slice(0, index + 1).join('/')) })),
  ];
  const dismissNotice = () => setParams(path ? { path } : {}, { replace: true });

  const { mutate: downloadItem } = download;
  const onDownload = useCallback(
    (item: OneDriveItem) => {
      setDownloadError(null);
      downloadItem(
        { path: item.path, name: item.name },
        { onError: (error) => setDownloadError(`“${item.name}” could not be downloaded. ${messageOf(error)}`) },
      );
    },
    [downloadItem],
  );

  // What the UI offers for the user's role (the API enforces it regardless).
  const ability = useAbility();
  const writable = ability.can('upload', 'File');
  const canRename = ability.can('update', 'File');
  const canDelete = ability.can('delete', 'File');
  const canConnect = ability.can('manage', 'File');

  const onPickFiles = (files: FileList | null) => {
    if (files && files.length > 0) void uploads.upload(Array.from(files));
    if (fileInput.current) fileInput.current.value = ''; // the same file can be chosen again
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (writable && connected) void uploads.upload(Array.from(event.dataTransfer.files));
  };

  const renderBody = () => {
    if (workspaces.isPending) return <Loader aria-label="Loading workspaces" />;
    if (workspaces.isError) {
      return (
        <EmptyState
          icon={IconAlertTriangle}
          title="We couldn't load your workspace"
          description={workspaces.error.message}
          action={<Button onClick={() => void workspaces.refetch()}>Try again</Button>}
        />
      );
    }
    if (!workspace) {
      return <EmptyState icon={IconFolders} title="No workspace" description="You are not a member of any workspace yet." />;
    }
    if (status.isPending) return <Loader aria-label="Checking OneDrive" />;
    if (status.isError) {
      return (
        <EmptyState
          icon={IconAlertTriangle}
          title="We couldn't check OneDrive"
          description={status.error.message}
          action={<Button onClick={() => void status.refetch()}>Try again</Button>}
        />
      );
    }
    if (status.data.status !== 'connected') {
      return (
        <ConnectionPanel
          status={status.data.status}
          canConnect={canConnect}
          connecting={connect.isPending}
          connectError={connect.isError ? messageOf(connect.error) : null}
          onConnect={() => connect.mutate()}
          onSignInAgain={auth.login}
          onRetry={() => void status.refetch()}
        />
      );
    }

    // A Microsoft session that needs renewing shows up as a 401 with this code while browsing.
    const reauth = items.error instanceof ApiError && items.error.code === 'MICROSOFT_REAUTH_REQUIRED';
    if (reauth) {
      return (
        <ConnectionPanel status="reauth_required" canConnect={false} connecting={false} connectError={null} onConnect={() => undefined} onSignInAgain={auth.login} onRetry={() => void items.refetch()} />
      );
    }

    return (
      <Stack gap="md">
        <Group justify="flex-end">
          <Group gap="xs">
            <Badge variant="light" color="green">
              OneDrive connected
            </Badge>
            <Button variant="default" size="xs" leftSection={<IconRefresh size={14} />} onClick={() => void items.refetch()} loading={items.isFetching && !items.isPending}>
              Refresh
            </Button>
            {writable && (
              <Button size="xs" leftSection={<IconUpload size={14} />} onClick={() => fileInput.current?.click()}>
                Upload
              </Button>
            )}
          </Group>
        </Group>

        {downloadError && (
          <Alert color="red" variant="light" role="alert" withCloseButton closeButtonLabel="Dismiss error" onClose={() => setDownloadError(null)}>
            {downloadError}
          </Alert>
        )}
        {items.data?.truncated && (
          <Alert color="yellow" variant="light">
            This folder has more items than can be shown here. Only the first 1000 are listed.
          </Alert>
        )}

        <Paper
          withBorder
          p={0}
          onDragOver={(event) => {
            if (writable) {
              event.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          style={dragging ? { outline: '2px dashed var(--mantine-primary-color-filled)' } : undefined}
        >
          <FileList
            items={items.data?.items ?? []}
            loading={items.isPending}
            error={items.error}
            onRetry={() => void items.refetch()}
            canRename={canRename}
            canDelete={canDelete}
            onOpenFolder={navigate}
            onDownload={onDownload}
            onRename={(item) => {
              rename.reset();
              setRenaming(item);
            }}
            onDelete={(item) => {
              remove.reset();
              setDeleting(item);
            }}
          />
        </Paper>
      </Stack>
    );
  };

  return (
    <PageContainer
      title="File Manager"
      description="Browse and manage the files in your workspace’s OneDrive folder."
      breadcrumbs={breadcrumbs}
    >
      <Stack gap="md">
        {notice && (
          <Alert color={notice.kind === 'success' ? 'green' : 'red'} variant="light" withCloseButton closeButtonLabel="Dismiss notice" onClose={dismissNotice} role={notice.kind === 'error' ? 'alert' : 'status'}>
            {notice.message}
          </Alert>
        )}
        {renderBody()}
      </Stack>

      <input ref={fileInput} type="file" multiple hidden aria-label="Choose files to upload" onChange={(event) => onPickFiles(event.currentTarget.files)} />

      <RenameModal
        item={renaming}
        pending={rename.isPending}
        error={rename.isError ? messageOf(rename.error) : null}
        onClose={() => setRenaming(null)}
        onSubmit={(newName) => {
          if (renaming) rename.mutate({ path: renaming.path, newName }, { onSuccess: () => setRenaming(null) });
        }}
      />
      <DeleteConfirmModal
        item={deleting}
        pending={remove.isPending}
        error={remove.isError ? messageOf(remove.error) : null}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.path, { onSuccess: () => setDeleting(null) });
        }}
      />
    </PageContainer>
  );
}
