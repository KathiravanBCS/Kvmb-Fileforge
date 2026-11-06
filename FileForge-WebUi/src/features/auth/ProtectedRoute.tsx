import { Button, Center } from '@mantine/core';
import { IconAlertTriangle, IconLock } from '@tabler/icons-react';
import { Outlet, useSearchParams } from 'react-router-dom';

import { EmptyState } from '@/components/feedback/EmptyState';
import { FullPageLoader } from '@/components/feedback/FullPageLoader';
import { getAuthErrorMessage } from './authErrors';
import { useAuth } from './useAuth';

export function ProtectedRoute() {
  const auth = useAuth();
  const signInError = getAuthErrorMessage(useSearchParams()[0].get('auth_error'));

  switch (auth.status) {
    case 'loading':
      return <FullPageLoader label="Checking your session…" />;

    // `preview` is development-only and carries no user; the shell shows an explicit banner for it.
    case 'authenticated':
    case 'preview':
      return <Outlet />;

    case 'unauthenticated':
      return (
        <Center mih="100vh" p="md">
          <EmptyState
            icon={IconLock}
            title={signInError ? 'Sign-in did not complete' : 'Sign in to continue'}
            description={signInError ?? 'You need to sign in with your Microsoft account to use FileForge AI.'}
            action={<Button onClick={auth.login}>Sign in with Microsoft</Button>}
          />
        </Center>
      );

    case 'error':
      return (
        <Center mih="100vh" p="md">
          <EmptyState
            icon={IconAlertTriangle}
            title="We couldn't verify your session"
            description={auth.error.message}
            action={<Button onClick={auth.refetch}>Try again</Button>}
          />
        </Center>
      );
  }
}
