import { useMemo } from 'react';
import { ActionIcon, Group, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconDownload, IconFile, IconFolder, IconFolderOpen, IconPencil, IconTrash } from '@tabler/icons-react';
import type { ColumnDef } from '@tanstack/react-table';
import dayjs from 'dayjs';

import { AppDataGrid } from '@/components/data/AppDataGrid';
import { EmptyState } from '@/components/feedback/EmptyState';
import { formatBytes } from '../utils';
import type { OneDriveItem } from '../types';

interface FileListProps {
  items: OneDriveItem[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  canRename: boolean;
  canDelete: boolean;
  onOpenFolder: (path: string) => void;
  onDownload: (item: OneDriveItem) => void;
  onRename: (item: OneDriveItem) => void;
  onDelete: (item: OneDriveItem) => void;
}

/** Folders and files of the current folder, in the app's data grid (sorting, search, loading and error states). */
export function FileList({ items, loading, error, onRetry, canRename, canDelete, onOpenFolder, onDownload, onRename, onDelete }: FileListProps) {
  const columns = useMemo<ColumnDef<OneDriveItem>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        size: 380,
        cell: ({ row }) => {
          const item = row.original;
          return item.type === 'folder' ? (
            <UnstyledButton onClick={() => onOpenFolder(item.path)} aria-label={`Open folder ${item.name}`}>
              <Group gap="xs" wrap="nowrap">
                <IconFolder size={18} aria-hidden />
                <Text size="sm" fw={500} truncate>
                  {item.name}
                </Text>
              </Group>
            </UnstyledButton>
          ) : (
            <Group gap="xs" wrap="nowrap">
              <IconFile size={18} aria-hidden />
              <Text size="sm" truncate>
                {item.name}
              </Text>
            </Group>
          );
        },
      },
      {
        id: 'size',
        header: 'Size',
        size: 110,
        accessorFn: (item) => (item.type === 'folder' ? -1 : item.size),
        cell: ({ row }) => (row.original.type === 'folder' ? '—' : formatBytes(row.original.size)),
        meta: { align: 'right', filterVariant: 'number' },
      },
      {
        id: 'modifiedAt',
        header: 'Modified',
        size: 170,
        accessorFn: (item) => item.modifiedAt ?? '',
        cell: ({ row }) => (row.original.modifiedAt ? dayjs(row.original.modifiedAt).format('D MMM YYYY, HH:mm') : '—'),
        meta: { filterVariant: 'date' },
      },
      {
        id: 'actions',
        header: '',
        size: 140,
        enableSorting: false,
        enableColumnFilter: false,
        enableResizing: false,
        cell: ({ row }) => {
          const item = row.original;
          if (item.type === 'folder') {
            return (
              <Tooltip label="Open folder">
                <ActionIcon variant="subtle" aria-label={`Open ${item.name}`} onClick={() => onOpenFolder(item.path)}>
                  <IconFolderOpen size={16} />
                </ActionIcon>
              </Tooltip>
            );
          }
          return (
            <Group gap={4} wrap="nowrap">
              <Tooltip label="Download">
                <ActionIcon variant="subtle" aria-label={`Download ${item.name}`} onClick={() => onDownload(item)}>
                  <IconDownload size={16} />
                </ActionIcon>
              </Tooltip>
              {canRename && (
                <Tooltip label="Rename">
                  <ActionIcon variant="subtle" aria-label={`Rename ${item.name}`} onClick={() => onRename(item)}>
                    <IconPencil size={16} />
                  </ActionIcon>
                </Tooltip>
              )}
              {canDelete && (
                <Tooltip label="Delete">
                  <ActionIcon variant="subtle" color="red" aria-label={`Delete ${item.name}`} onClick={() => onDelete(item)}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          );
        },
      },
    ],
    [canRename, canDelete, onOpenFolder, onDownload, onRename, onDelete],
  );

  return (
    <AppDataGrid<OneDriveItem>
      data={items}
      columns={columns}
      getRowId={(item) => item.path}
      aria-label="Files and folders"
      loading={loading}
      error={error}
      onRetry={onRetry}
      onRowDoubleClick={(row) => row.original.type === 'folder' && onOpenFolder(row.original.path)}
      renderEmpty={({ filtered }) => (
        <EmptyState
          icon={IconFolder}
          title={filtered ? 'No matching files' : 'This folder is empty'}
          description={filtered ? 'Try a different search.' : 'Upload files to see them here.'}
        />
      )}
    />
  );
}
