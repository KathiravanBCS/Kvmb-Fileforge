import { Alert } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

import { useAuth } from '../useAuth';

/** Shown whenever the shell runs without a real session (development preview). */
export function PreviewBanner() {
  const { status } = useAuth();
  if (status !== 'preview') return null;

  return (
    <Alert
      variant="light"
      color="yellow"
      icon={<IconAlertTriangle size={18} />}
      title="Development preview — not signed in"
      mb="lg"
    >
      The backend authentication endpoints are not available, so you are not authenticated. Only placeholder pages are
      shown; no protected data is loaded.
    </Alert>
  );
}
