import { Paper, Tabs } from '@mantine/core';
import { IconBell, IconPlugConnected } from '@tabler/icons-react';

import { EmptyState } from '@/components/feedback/EmptyState';
import { PageContainer } from '@/components/layout/PageContainer';
import { AccountSettings } from '../components/AccountSettings';
import { AppearanceSettings } from '../components/AppearanceSettings';
import classes from './SettingsPage.module.css';

export function SettingsPage() {
  return (
    <PageContainer title="Settings" description="Manage your account, appearance and connections.">
      <Tabs defaultValue="appearance" variant="pills" keepMounted={false} classNames={{ tab: classes.tab, list: classes.list }}>
        <Tabs.List>
          <Tabs.Tab value="account">Account</Tabs.Tab>
          <Tabs.Tab value="appearance">Appearance</Tabs.Tab>
          <Tabs.Tab value="notifications">Notifications</Tabs.Tab>
          <Tabs.Tab value="integrations">Integrations</Tabs.Tab>
        </Tabs.List>

        <Paper withBorder p={{ base: 'md', sm: 'xl' }} mt="md">
          <Tabs.Panel value="account">
            <AccountSettings />
          </Tabs.Panel>
          <Tabs.Panel value="appearance">
            <AppearanceSettings />
          </Tabs.Panel>
          <Tabs.Panel value="notifications">
            <EmptyState
              icon={IconBell}
              title="Coming soon"
              description="Notification preferences will arrive in a later phase."
            />
          </Tabs.Panel>
          <Tabs.Panel value="integrations">
            <EmptyState
              icon={IconPlugConnected}
              title="Coming soon"
              description="Connections to other services will arrive in a later phase."
            />
          </Tabs.Panel>
        </Paper>
      </Tabs>
    </PageContainer>
  );
}
