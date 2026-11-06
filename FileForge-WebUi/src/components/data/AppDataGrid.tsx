import type { RowData } from '@tanstack/react-table';
import { DataGrid, DataGridRoot, type DataGridProps, type DataGridRootProps } from '@kvmb/react-data-grid';

import '@kvmb/react-data-grid/styles.css';

// The external toolbar controls (search, chips, filter builder, column/density menus, ...) and the table-only view of the
// same grid. Use them inside `AppDataGridRoot` to put the controls anywhere on the page (see central-storage pages).
export {
  ColumnManager,
  DataGridView as AppDataGridView,
  DensityMenu,
  ExportMenu,
  FilterBuilderButton,
  FilterChips,
  GlobalSearch,
  SelectionBar,
} from '@kvmb/react-data-grid';

const DEFAULT_MAX_HEIGHT = 560;

/** The app's defaults, shared by the all-in-one grid and the split (root + view) grid. */
const APP_GRID_DEFAULTS = {
  enableSorting: true,
  enableFiltering: true,
  enableGlobalFilter: true,
  enableFilterBuilder: true,
  enableColumnResizing: true,
  enableRowSelection: true,
  enableVirtualization: true,
  enableDensityToggle: true,
  enableHiding: true,
  enablePagination: false,
  withColumnBorders: true,
  highlightOnHover: true,
  striped: true,
  stickyHeader: true,
} as const;

/**
 * The one table every page uses. It is the kvmb `DataGrid` with the app's defaults switched on:
 * virtualized rows, sorting, per-column filters + filter builder, global search, column resizing,
 * column borders, row selection, striped rows, and the column / density toolbar.
 *
 * Every `DataGrid` prop is accepted and wins over a default, so a page only passes what differs
 * (`data`, `columns`, `getRowId`, `aria-label`, plus things like `loading`, `error` or `renderEmpty`).
 * Virtualization needs a bounded height: unless `height` or `maxHeight` is given, the grid grows with
 * its rows up to 560px and scrolls beyond that.
 */
export function AppDataGrid<TData extends RowData>(props: DataGridProps<TData>) {
  const sized = props.height !== undefined || props.maxHeight !== undefined;

  return (
    <DataGrid<TData> {...APP_GRID_DEFAULTS} {...props} maxHeight={sized ? props.maxHeight : DEFAULT_MAX_HEIGHT} />
  );
}

/**
 * The split form of `AppDataGrid` (kvmb 0.2 external toolbar): the root owns the grid state with the same app defaults and
 * renders no toolbar of its own; render `AppDataGridView` for the table and the exported controls wherever they belong.
 */
export function AppDataGridRoot<TData extends RowData>(props: DataGridRootProps<TData>) {
  const sized = props.height !== undefined || props.maxHeight !== undefined;

  return (
    <DataGridRoot<TData> {...APP_GRID_DEFAULTS} {...props} maxHeight={sized ? props.maxHeight : DEFAULT_MAX_HEIGHT} />
  );
}
