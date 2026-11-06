import type { ReactNode } from 'react';
import { Button, Loader } from '@mantine/core';
import { IconAlertTriangle, IconLock } from '@tabler/icons-react';

import { EmptyState } from '@/components/feedback/EmptyState';
import { useAbility } from '@/lib/casl/hooks';
import { useGetCapabilities } from '../api/useGetCapabilities';

/**
 * Renders its children only for a verified system administrator: the API's `isSystemAdmin` answer, nothing the browser can
 * set. Anyone else gets an explanation, and no administrator data is requested (the children, which make those requests,
 * are never rendered). The API still answers 403 to a non-administrator, so this is UX, not the protection.
 */
export function AdminOnly({ children }: { children: ReactNode }) {
  const capabilities = useGetCapabilities();
  const ability = useAbility();

  if (capabilities.isPending) return <Loader aria-label="Checking your permissions" m="xl" />;
  if (capabilities.isError) {
    return (
      <EmptyState
        icon={IconAlertTriangle}
        title="We couldn’t check your permissions"
        description={capabilities.error.message}
        action={<Button onClick={() => void capabilities.refetch()}>Try again</Button>}
      />
    );
  }
  if (!ability.can('manage', 'CentralStorageAdministration')) {
    return (
      <EmptyState
        icon={IconLock}
        title="Administrators only"
        description="This page is for system administrators. If you need access, ask an administrator."
      />
    );
  }
  return <>{children}</>;
}
