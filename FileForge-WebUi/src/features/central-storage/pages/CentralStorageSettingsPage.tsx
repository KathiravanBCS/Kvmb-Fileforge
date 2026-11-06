import { Alert, Button, Loader, Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { EmptyState } from '@/components/feedback/EmptyState';
import { PageContainer } from '@/components/layout/PageContainer';
import { useConnectCentralStorage } from '../api/useConnectCentralStorage';
import { useGetConnection } from '../api/useGetConnection';
import { useVerifyConnection } from '../api/useVerifyConnection';
import { AdminOnly } from '../components/AdminOnly';
import { CentralStorageConnectionCard } from '../components/CentralStorageConnectionCard';
import { getCentralNotice } from '../messages';
import { describeError } from '../utils';

/**
 * Storage Settings: connect (or reconnect) the administrator's OneDrive that holds every user's files. The browser only starts
 * the flow: the API returns the Microsoft consent address, Microsoft redirects back to the API, and the API keeps the access.
 * Nothing here ever receives or stores a token. Only rendered for a verified system administrator.
 */
export function CentralStorageSettingsPage() {
  return (
    <AdminOnly>
      <Settings />
    </AdminOnly>
  );
}

function Settings() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const notice = getCentralNotice(params);

  const connection = useGetConnection();
  const connect = useConnectCentralStorage();
  const verify = useVerifyConnection();

  const dismissNotice = () => setParams({}, { replace: true });

  return (
    <PageContainer
      title="Storage Settings"
      description="The OneDrive that holds every user’s files."
      breadcrumbs={[{ label: 'Admin Storage', onClick: () => navigate('/admin/storage') }, { label: 'Settings' }]}
    >
      <Stack gap="md" maw={760}>
        {notice && (
          <Alert
            color={notice.kind === 'success' ? 'green' : 'red'}
            variant="light"
            withCloseButton
            closeButtonLabel="Dismiss notice"
            onClose={dismissNotice}
            role={notice.kind === 'error' ? 'alert' : 'status'}
          >
            {notice.message}
          </Alert>
        )}

        {connection.isPending && <Loader aria-label="Loading the connection status" />}
        {connection.isError && (
          <EmptyState
            icon={IconAlertTriangle}
            title="We couldn’t load the connection status"
            description={describeError(connection.error)}
            action={<Button onClick={() => void connection.refetch()}>Try again</Button>}
          />
        )}
        {connection.isSuccess && (
          <CentralStorageConnectionCard
            status={connection.data}
            onConnect={() => connect.mutate()}
            connecting={connect.isPending || connect.isSuccess}
            connectError={connect.isError ? describeError(connect.error) : null}
            onVerify={() =>
              verify.mutate(undefined, {
                onSuccess: (status) =>
                  // Honest result: success only when the API itself says the connection works.
                  status.usable
                    ? notifications.show({ color: 'green', title: 'Connection works', message: 'OneDrive answered and the storage folder is reachable.' })
                    : notifications.show({ color: 'red', title: 'The connection is not working', message: 'See the status below for what to do.', autoClose: false }),
              })
            }
            verifying={verify.isPending}
            verifyError={verify.isError ? describeError(verify.error) : null}
          />
        )}
      </Stack>
    </PageContainer>
  );
}
