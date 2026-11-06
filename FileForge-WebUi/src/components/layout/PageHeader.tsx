import type { ReactNode } from 'react';
import { Group, Stack, Text, Title } from '@mantine/core';

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Buttons aligned to the right of the title. */
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <Group justify="space-between" align="center" gap="md">
      <Stack gap={2}>
        <Title order={1} size="h3">
          {title}
        </Title>
        {description && (
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        )}
      </Stack>
      {actions && <Group gap="xs">{actions}</Group>}
    </Group>
  );
}
