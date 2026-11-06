import { useCallback, useState } from 'react';

import type { AdminFilesQuery } from '../types';

/** What the list is showing: the server does the searching, filtering, sorting and paging from exactly this. */
export type ListState = AdminFilesQuery;

export const DEFAULT_LIST_STATE: ListState = { page: 1, pageSize: 25, sort: 'date', order: 'desc' };

/** True when anything narrows the list (so an empty result means "no matches", not "no files"). */
export function hasActiveFilters(state: ListState): boolean {
  return Boolean(state.search) || state.type !== undefined || state.ownerUserId !== undefined;
}

/**
 * The list's search / filter / sort / page state. Changing anything but the page goes back to page 1, so a new search never
 * leaves you on page 7 of nothing.
 */
export function useFileListState(initial: Partial<ListState> = {}) {
  const [state, setState] = useState<ListState>({ ...DEFAULT_LIST_STATE, ...initial });

  const change = useCallback((patch: Partial<ListState>) => {
    setState((current) => ({ ...current, page: 1, ...patch }));
  }, []);

  const clearFilters = useCallback(() => {
    setState((current) => ({ ...current, page: 1, search: undefined, type: undefined, ownerUserId: undefined }));
  }, []);

  return { state, change, clearFilters };
}
