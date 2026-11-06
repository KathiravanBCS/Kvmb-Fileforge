import { useMemo } from 'react';
import { ActionIcon, Badge, Group, Menu, Text, ThemeIcon, Tooltip, UnstyledButton } from '@mantine/core';
import { IconDots, IconDownload, IconEye, IconInfoCircle, IconPencil, IconReplace, IconTrash } from '@tabler/icons-react';
import type { ColumnDef } from '@tanstack/react-table';
import dayjs from 'dayjs';

import type { CentralFile } from '../types';
import { fileKind, formatBytes, ownerLabel } from '../utils';

export interface FileActions {
  onOpen: (file: CentralFile) => void;
  onPreview: (file: CentralFile) => void;
  onDownload: (file: CentralFile) => void;
  onRename: (file: CentralFile) => void;
  onReplace: (file: CentralFile) => void;
  onDelete: (file: CentralFile) => void;
}

interface ColumnOptions {
  /** Administrator view: adds the owner column. */
  showOwner: boolean;
  /** Storage unavailable: everything that needs OneDrive is disabled (renaming only changes the database, so it stays). */
  contentDisabled: boolean;
  actions: FileActions;
}

/**
 * The columns of the file table. The ids of the sortable ones (`name`, `size`, `type`, `date`) are the API's own sort fields,
 * because the server sorts: the table only reports which column was clicked.
 */
export function useCentralFileColumns({ showOwner, contentDisabled, actions }: ColumnOptions): ColumnDef<CentralFile>[] {
  return useMemo(() => {
    const columns: ColumnDef<CentralFile>[] = [
      {
        id: 'name',
        header: 'Name',
        size: 340,
        accessorFn: (file) => file.name,
        cell: ({ row }) => {
          const file = row.original;
          const kind = fileKind(file.extension);
          return (
            <Group gap="xs" wrap="nowrap" miw={0}>
              <ThemeIcon variant="light" color={kind.color} size="md" aria-hidden>
                <kind.icon size={16} />
              </ThemeIcon>
              <UnstyledButton onClick={() => actions.onOpen(file)} aria-label={`Details of ${file.name}`} miw={0}>
                <Text size="sm" fw={500} truncate>
                  {file.name}
                </Text>
              </UnstyledButton>
              {file.status === 'replacing' && (
                <Badge size="xs" variant="light" color="yellow">
                  Updating
                </Badge>
              )}
            </Group>
          );
        },
      },
      {
        id: 'type',
        header: 'Type',
        size: 120,
        accessorFn: (file) => fileKind(file.extension).label,
        cell: ({ row }) => {
          const kind = fileKind(row.original.extension);
          return (
            <Badge variant="light" color={kind.color} size="sm">
              {kind.label}
            </Badge>
          );
        },
      },
    ];

    if (showOwner) {
      columns.push({
        id: 'owner',
        header: 'Owner',
        size: 220,
        // The server cannot sort by owner, so the header offers no sort.
        enableSorting: false,
        accessorFn: (file) => ownerLabel(file.owner),
        cell: ({ row }) => (
          <div>
            <Text size="sm" truncate>
              {ownerLabel(row.original.owner)}
            </Text>
            {row.original.owner?.displayName && (
              <Text size="xs" c="dimmed" truncate>
                {row.original.owner.email}
              </Text>
            )}
          </div>
        ),
      });
    }

    columns.push(
      {
        id: 'size',
        header: 'Size',
        size: 100,
        accessorFn: (file) => file.size,
        cell: ({ row }) => formatBytes(row.original.size),
        meta: { align: 'right' },
      },
      {
        id: 'date',
        header: 'Uploaded',
        size: 160,
        accessorFn: (file) => file.createdAt,
        cell: ({ row }) => dayjs(row.original.createdAt).format('D MMM YYYY, HH:mm'),
      },
      {
        id: 'actions',
        header: '',
        size: 132,
        enableSorting: false,
        enableResizing: false,
        cell: ({ row }) => {
          const file = row.original;
          return (
            <Group gap={2} wrap="nowrap">
              {file.previewable && (
                <Tooltip label="Preview">
                  <ActionIcon variant="subtle" aria-label={`Preview ${file.name}`} disabled={contentDisabled} onClick={() => actions.onPreview(file)}>
                    <IconEye size={16} />
                  </ActionIcon>
                </Tooltip>
              )}
              <Tooltip label="Download">
                <ActionIcon variant="subtle" aria-label={`Download ${file.name}`} disabled={contentDisabled} onClick={() => actions.onDownload(file)}>
                  <IconDownload size={16} />
                </ActionIcon>
              </Tooltip>
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon variant="subtle" color="gray" aria-label={`More actions for ${file.name}`}>
                    <IconDots size={16} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<IconInfoCircle size={14} />} onClick={() => actions.onOpen(file)}>
                    Details
                  </Menu.Item>
                  <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => actions.onRename(file)}>
                    Rename
                  </Menu.Item>
                  <Menu.Item leftSection={<IconReplace size={14} />} disabled={contentDisabled} onClick={() => actions.onReplace(file)}>
                    Replace content
                  </Menu.Item>
                  <Menu.Divider />
                  <Menu.Item color="red" leftSection={<IconTrash size={14} />} disabled={contentDisabled} onClick={() => actions.onDelete(file)}>
                    Delete
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          );
        },
      },
    );
    return columns;
  }, [showOwner, contentDisabled, actions]);
}
