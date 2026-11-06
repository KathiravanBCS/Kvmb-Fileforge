import { type ReactNode } from 'react';
import type { ColumnDef, PaginationState, SortingState } from '@tanstack/react-table';

import { AppDataGridRoot } from '@/components/data/AppDataGrid';
import type { ListState } from '../hooks/useFileListState';
import type { CentralFile, CentralFileSortField } from '../types';

const SORT_FIELDS: readonly string[] = ['name', 'size', 'type', 'date'];
const PAGE_SIZES = [10, 25, 50, 100];

interface CentralFilesGridProps {
  files: CentralFile[];
  /** Matches on the server (all pages), not the rows on screen. */
  total: number;
  /** First load only: later pages keep the previous rows on screen while they load. */
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  state: ListState;
  onStateChange: (patch: Partial<ListState>) => void;
  columns: ColumnDef<CentralFile>[];
  ariaLabel: string;
  /** What an empty table shows (the page knows whether that means "no files" or "no matches"). */
  empty: ReactNode;
  /** The page layout. Anything inside (search box, chips, menus, the table view) shares this grid's state. */
  children: ReactNode;
}

/**
 * The file table's state holder (kvmb 0.2 `DataGridRoot`). The SERVER searches, sorts and pages, so the grid runs in manual
 * mode and only reports what the user asked for (search text, sort column, page); the page turns that into the next request.
 * Place `GlobalSearch`, menus and `AppDataGridView` anywhere inside it.
 */
export function CentralFilesGrid({ files, total, loading, error, onRetry, state, onStateChange, columns, ariaLabel, empty, children }: CentralFilesGridProps) {
  const sorting: SortingState = [{ id: state.sort, desc: state.order === 'desc' }];
  const pagination: PaginationState = { pageIndex: state.page - 1, pageSize: state.pageSize };

  return (
    <AppDataGridRoot<CentralFile>
      data={files}
      columns={columns}
      getRowId={(file) => file.id}
      aria-label={ariaLabel}
      loading={loading}
      error={error}
      onRetry={onRetry}
      renderEmpty={() => empty}
      // Search: the grid debounces typing, the server filters.
      enableGlobalFilter
      enableFiltering={false}
      enableFilterBuilder={false}
      manualFiltering
      globalFilter={state.search ?? ''}
      onGlobalFilterChange={(value) => onStateChange({ search: value.trim() === '' ? undefined : value })}
      // Sorting: one column at a time, in the API's own sort fields.
      enableMultiSort={false}
      manualSorting
      sorting={sorting}
      onSortingChange={(next) => {
        const first = next[0];
        if (first && SORT_FIELDS.includes(first.id)) {
          onStateChange({ sort: first.id as CentralFileSortField, order: first.desc ? 'desc' : 'asc' });
        } else {
          onStateChange({ sort: 'date', order: 'desc' }); // clearing the sort goes back to newest first
        }
      }}
      // Paging.
      enablePagination
      manualPagination
      rowCount={total}
      pagination={pagination}
      onPaginationChange={(next) => onStateChange({ page: next.pageIndex + 1, pageSize: next.pageSize })}
      pageSizeOptions={PAGE_SIZES}
      enableRowSelection={false}
      maxHeight="max(360px, calc(100dvh - 400px))"
    >
      {children}
    </AppDataGridRoot>
  );
}
