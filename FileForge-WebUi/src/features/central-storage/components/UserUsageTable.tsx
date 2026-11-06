import { useMemo } from 'react';
import { Button, Text } from '@mantine/core';
import { IconUsers } from '@tabler/icons-react';
import type { ColumnDef } from '@tanstack/react-table';

import { AppDataGrid } from '@/components/data/AppDataGrid';
import { EmptyState } from '@/components/feedback/EmptyState';
import type { AdminUserUsage } from '../types';
import { formatBytes } from '../utils';

interface UserUsageTableProps {
  users: AdminUserUsage[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  /** "View files": filters the file list by this owner. */
  onViewFiles: (userId: string) => void;
}

/** Storage used by each user that has files (the shared data grid, sorted by size). */
export function UserUsageTable({ users, loading, error, onRetry, onViewFiles }: UserUsageTableProps) {
  const columns = useMemo<ColumnDef<AdminUserUsage>[]>(
    () => [
      {
        id: 'user',
        header: 'User',
        size: 320,
        accessorFn: (user) => user.displayName ?? user.email,
        cell: ({ row }) => (
          <div>
            <Text size="sm" fw={500} truncate>
              {row.original.displayName ?? row.original.email}
            </Text>
            {row.original.displayName && (
              <Text size="xs" c="dimmed" truncate>
                {row.original.email}
              </Text>
            )}
          </div>
        ),
      },
      { id: 'files', header: 'Files', size: 90, accessorFn: (user) => user.fileCount, meta: { align: 'right' } },
      {
        id: 'size',
        header: 'Storage used',
        size: 140,
        accessorFn: (user) => user.totalBytes,
        cell: ({ row }) => formatBytes(row.original.totalBytes),
        meta: { align: 'right' },
      },
      {
        id: 'actions',
        header: '',
        size: 120,
        enableSorting: false,
        enableResizing: false,
        cell: ({ row }) => (
          <Button variant="subtle" size="compact-xs" onClick={() => onViewFiles(row.original.id)} aria-label={`View files of ${row.original.email}`}>
            View files
          </Button>
        ),
      },
    ],
    [onViewFiles],
  );

  return (
    <AppDataGrid<AdminUserUsage>
      data={users}
      columns={columns}
      getRowId={(user) => user.id}
      aria-label="Storage used by each user"
      loading={loading}
      error={error}
      onRetry={onRetry}
      enableRowSelection={false}
      enableFilterBuilder={false}
      defaultSorting={[{ id: 'size', desc: true }]}
      renderEmpty={() => <EmptyState icon={IconUsers} title="No files yet" description="Nobody has uploaded a file." />}
    />
  );
}
