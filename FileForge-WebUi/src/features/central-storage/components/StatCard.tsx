import { Paper, Skeleton, Stack, Text } from '@mantine/core';

interface StatCardProps {
  label: string;
  /** The big figure. */
  value: string | undefined;
  /** Smaller line under it. */
  hint?: string;
  loading: boolean;
  /** Failed to load: a dash is shown, never a made-up number. */
  error?: boolean;
}

/** One figure with a label (a small dashboard tile). */
export function StatCard({ label, value, hint, loading, error = false }: StatCardProps) {
  return (
    <Paper withBorder p="md" aria-label={label} role="group">
      <Stack gap={2}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          {label}
        </Text>
        {loading ? (
          <Skeleton height={28} width={120} />
        ) : error || value === undefined ? (
          <Text fz="xl" fw={600} c="dimmed">
            —
          </Text>
        ) : (
          <>
            <Text fz="xl" fw={600}>
              {value}
            </Text>
            {hint && (
              <Text size="xs" c="dimmed">
                {hint}
              </Text>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
}
