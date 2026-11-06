import { useMemo } from 'react';
import { Select } from '@mantine/core';

import type { AdminUserUsage } from '../types';

interface UserStorageFilterProps {
  users: AdminUserUsage[];
  loading: boolean;
  value: string | undefined;
  onChange: (userId: string | undefined) => void;
  label?: string;
  placeholder?: string;
  /** Required choice (upload target) instead of an optional filter. */
  required?: boolean;
  error?: string;
}

/** Pick a user (by name or e-mail). Used as the "owner" filter and as the target of "upload for user". */
export function UserStorageFilter({ users, loading, value, onChange, label, placeholder = 'All users', required = false, error }: UserStorageFilterProps) {
  const data = useMemo(
    () =>
      users.map((user) => ({
        value: user.id,
        label: user.displayName ? `${user.displayName} (${user.email})` : user.email,
      })),
    [users],
  );

  return (
    <Select
      label={label}
      aria-label={label ? undefined : 'Filter by owner'}
      placeholder={loading ? 'Loading users…' : placeholder}
      size={label ? 'sm' : 'xs'}
      w={label ? undefined : 240}
      searchable
      clearable={!required}
      withAsterisk={required}
      nothingFoundMessage="No matching user"
      data={data}
      value={value ?? null}
      onChange={(next) => onChange(next ?? undefined)}
      error={error}
    />
  );
}
