import { Text } from '@mantine/core';

import { useAuth } from '@/features/auth/useAuth';
import { SettingsRow, SettingsSection } from './SettingsRow';

export function AccountSettings() {
  const auth = useAuth();
  const user = auth.status === 'authenticated' ? auth.user : null;

  return (
    <SettingsSection title="Account" description="Your sign-in details. These come from your Microsoft account.">
      <SettingsRow label="Name" description="Shown in the sidebar and on records you create.">
        <Text size="sm">{user ? (user.displayName ?? '—') : 'Not signed in'}</Text>
      </SettingsRow>
      <SettingsRow label="Email" description="The address you sign in with.">
        <Text size="sm">{user?.email ?? '—'}</Text>
      </SettingsRow>
    </SettingsSection>
  );
}
