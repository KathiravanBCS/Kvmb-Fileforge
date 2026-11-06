import { useMemo } from 'react';
import { Badge, Button, Text } from '@mantine/core';
import { IconCircleCheck } from '@tabler/icons-react';
import type { ColumnDef } from '@tanstack/react-table';

import { AppDataGrid } from '@/components/data/AppDataGrid';
import { EmptyState } from '@/components/feedback/EmptyState';
import { formatWhen, problemLabel, STATE_BADGE } from '../recovery';
import type { RecoveryItem } from '../types';
import { formatBytes, ownerLabel } from '../utils';

interface RecoveryTableProps {
  items: RecoveryItem[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  onOpen: (item: RecoveryItem) => void;
}

/** The files that need attention, worst first (the API sends "needs review" before the rest). */
export function RecoveryTable({ items, loading, error, onRetry, onOpen }: RecoveryTableProps) {
  const columns = useMemo<ColumnDef<RecoveryItem>[]>(
    () => [
      {
        id: 'file',
        header: 'File',
        size: 280,
        accessorFn: (item) => item.fileName,
        cell: ({ row }) => (
          <div>
            <Text size="sm" fw={500} truncate>
              {row.original.fileName}
            </Text>
            <Text size="xs" c="dimmed">
              {formatBytes(row.original.sizeBytes)}
            </Text>
          </div>
        ),
      },
      {
        id: 'owner',
        header: 'Owner',
        size: 200,
        accessorFn: (item) => ownerLabel(item.owner ?? undefined),
        cell: ({ row }) => (
          <Text size="sm" truncate>
            {ownerLabel(row.original.owner ?? undefined)}
          </Text>
        ),
      },
      { id: 'problem', header: 'Problem', size: 190, accessorFn: (item) => problemLabel(item.status) },
      {
        id: 'state',
        header: 'State',
        size: 130,
        accessorFn: (item) => STATE_BADGE[item.state].label,
        cell: ({ row }) => {
          const badge = STATE_BADGE[row.original.state];
          return (
            <Badge variant="light" color={badge.color} size="sm">
              {row.original.inProgress ? 'Working…' : badge.label}
            </Badge>
          );
        },
      },
      {
        id: 'attempts',
        header: 'Attempts',
        size: 100,
        accessorFn: (item) => item.attempts,
        cell: ({ row }) => `${row.original.attempts} of ${row.original.maxAttempts}`,
        meta: { align: 'right' },
      },
      {
        id: 'checked',
        header: 'Last checked',
        size: 170,
        accessorFn: (item) => item.lastRecoveryAt ?? '',
        cell: ({ row }) => formatWhen(row.original.lastRecoveryAt),
      },
      {
        id: 'next',
        header: 'Next attempt',
        size: 170,
        accessorFn: (item) => item.nextRecoveryAt ?? '',
        cell: ({ row }) => (row.original.state === 'needs_review' ? '—' : formatWhen(row.original.nextRecoveryAt)),
      },
      {
        id: 'actions',
        header: '',
        size: 100,
        enableSorting: false,
        enableResizing: false,
        cell: ({ row }) => (
          <Button variant="subtle" size="compact-xs" onClick={() => onOpen(row.original)} aria-label={`Details of ${row.original.fileName}`}>
            Details
          </Button>
        ),
      },
    ],
    [onOpen],
  );

  return (
    <AppDataGrid<RecoveryItem>
      data={items}
      columns={columns}
      getRowId={(item) => item.id}
      aria-label="Files that need recovery"
      loading={loading}
      error={error}
      onRetry={onRetry}
      enableRowSelection={false}
      enableFilterBuilder={false}
      renderEmpty={() => (
        <EmptyState icon={IconCircleCheck} title="Nothing needs attention" description="Every upload, replacement and delete has finished." />
      )}
    />
  );
}
