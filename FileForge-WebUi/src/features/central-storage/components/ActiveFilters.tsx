import type { ReactNode } from 'react';
import { Badge, Button, CloseButton, Group } from '@mantine/core';

import { hasActiveFilters, type ListState } from '../hooks/useFileListState';
import { TYPE_OPTIONS } from '../utils';

interface ActiveFiltersProps {
  state: ListState;
  /** Display name of the selected owner (administrators). */
  ownerName?: string;
  onChange: (patch: Partial<ListState>) => void;
  onClear: () => void;
}

/** One removable filter. The remove button is a real, focusable button with a name (Mantine's own pill hides it from keyboards). */
function Chip({ children, removeLabel, onRemove }: { children: ReactNode; removeLabel: string; onRemove: () => void }) {
  return (
    <Badge
      variant="light"
      size="lg"
      tt="none"
      fw={500}
      pr={4}
      rightSection={<CloseButton size="xs" radius="xl" aria-label={removeLabel} onClick={onRemove} />}
    >
      {children}
    </Badge>
  );
}

/** What is currently narrowing the list, each removable, plus one "Clear all filters". Renders nothing when nothing is. */
export function ActiveFilters({ state, ownerName, onChange, onClear }: ActiveFiltersProps) {
  if (!hasActiveFilters(state)) return null;
  const typeLabel = TYPE_OPTIONS.find((option) => option.value === state.type)?.label;

  return (
    <Group gap="xs" aria-label="Active filters" role="group">
      {state.search && (
        <Chip removeLabel="Remove search filter" onRemove={() => onChange({ search: undefined })}>
          Search: {state.search}
        </Chip>
      )}
      {state.type && (
        <Chip removeLabel="Remove type filter" onRemove={() => onChange({ type: undefined })}>
          Type: {typeLabel ?? state.type}
        </Chip>
      )}
      {state.ownerUserId && (
        <Chip removeLabel="Remove owner filter" onRemove={() => onChange({ ownerUserId: undefined })}>
          Owner: {ownerName ?? state.ownerUserId}
        </Chip>
      )}
      <Button variant="subtle" size="compact-xs" onClick={onClear}>
        Clear all filters
      </Button>
    </Group>
  );
}
