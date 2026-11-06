import { Button, Center } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';

import { EmptyState } from './EmptyState';

export function RouteError() {
  const error = useRouteError();
  const description = isRouteErrorResponse(error)
    ? `The request failed with status ${error.status}.`
    : 'An unexpected error occurred while loading this page.';

  return (
    <Center mih="50vh">
      <EmptyState
        icon={IconAlertTriangle}
        title="Something went wrong"
        description={description}
        action={<Button onClick={() => window.location.reload()}>Reload page</Button>}
      />
    </Center>
  );
}
