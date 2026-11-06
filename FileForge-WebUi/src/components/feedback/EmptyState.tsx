import type { ReactNode } from 'react';
import { Stack, Text, ThemeIcon, Title } from '@mantine/core';
import type { Icon } from '@tabler/icons-react';

interface EmptyStateProps {
  icon: Icon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon: IconComponent, title, description, action }: EmptyStateProps) {
  return (
    <Stack align="center" gap="xs" py="xl" ta="center" maw={420} mx="auto">
      <ThemeIcon size={56} radius="xl" variant="light">
        <IconComponent size={28} stroke={1.5} aria-hidden />
      </ThemeIcon>
      <Title order={3} mt="xs">
        {title}
      </Title>
      {description && (
        <Text c="dimmed" size="sm">
          {description}
        </Text>
      )}
      {action && <div>{action}</div>}
    </Stack>
  );
}
