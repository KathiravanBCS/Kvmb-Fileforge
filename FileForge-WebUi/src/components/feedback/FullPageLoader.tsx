import { Center, Loader, Stack, Text } from '@mantine/core';

export function FullPageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <Center mih="100vh">
      <Stack align="center" gap="sm" role="status" aria-live="polite">
        <Loader />
        <Text c="dimmed" size="sm">
          {label}
        </Text>
      </Stack>
    </Center>
  );
}
