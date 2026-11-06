import { Select } from '@mantine/core';

import type { CentralFileType } from '../types';
import { TYPE_OPTIONS } from '../utils';

interface FileTypeFilterProps {
  value: CentralFileType | undefined;
  onChange: (value: CentralFileType | undefined) => void;
}

/** "All types", or one kind of file. The server applies it. */
export function FileTypeFilter({ value, onChange }: FileTypeFilterProps) {
  return (
    <Select
      aria-label="Filter by file type"
      placeholder="All types"
      size="xs"
      w={150}
      clearable
      data={TYPE_OPTIONS}
      value={value ?? null}
      onChange={(next) => onChange((next as CentralFileType | null) ?? undefined)}
    />
  );
}
