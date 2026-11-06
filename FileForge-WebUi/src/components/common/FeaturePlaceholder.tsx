import { Paper } from '@mantine/core';
import type { Icon } from '@tabler/icons-react';

import { EmptyState } from '@/components/feedback/EmptyState';
import { PageContainer } from '@/components/layout/PageContainer';

interface FeaturePlaceholderProps {
  title: string;
  description: string;
  icon: Icon;
}

export function FeaturePlaceholder({ title, description, icon }: FeaturePlaceholderProps) {
  return (
    <PageContainer title={title} description={description}>
      <Paper withBorder p="xl">
        <EmptyState
          icon={icon}
          title="Coming soon"
          description="This module is not built yet. It will arrive in a later phase."
        />
      </Paper>
    </PageContainer>
  );
}
