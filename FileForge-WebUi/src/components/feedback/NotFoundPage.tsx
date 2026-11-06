import { Button } from '@mantine/core';
import { IconError404 } from '@tabler/icons-react';
import { Link } from 'react-router-dom';

import { PageContainer } from '@/components/layout/PageContainer';
import { EmptyState } from './EmptyState';

export function NotFoundPage() {
  return (
    <PageContainer title="Page not found">
      <EmptyState
        icon={IconError404}
        title="We couldn't find that page"
        description="The address may be mistyped, or the page may have moved."
        action={
          <Button component={Link} to="/dashboard">
            Back to dashboard
          </Button>
        }
      />
    </PageContainer>
  );
}
