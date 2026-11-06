import { useMemo, type ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';

import { useThemeStore } from '@/app/store/themeStore';
import { createAppTheme } from '@/app/theme/theme';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { QueryProvider } from './QueryProvider';

import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import '@/app/theme/scrollbars.css';

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  const primaryColor = useThemeStore((state) => state.primaryColor);
  const theme = useMemo(() => createAppTheme(primaryColor), [primaryColor]);

  return (
    <QueryProvider>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <Notifications position="bottom-right" />
        <AuthProvider>{children}</AuthProvider>
      </MantineProvider>
    </QueryProvider>
  );
}
