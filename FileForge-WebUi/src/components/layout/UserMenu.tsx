import { useState } from 'react';
import { Avatar, Menu, Text, UnstyledButton } from '@mantine/core';
import { IconAlertTriangle, IconLogout, IconSettings } from '@tabler/icons-react';
import { Link } from 'react-router-dom';

import { useAuth } from '@/features/auth/useAuth';
import classes from './AppSidebar.module.css';

interface UserMenuProps {
  /** Avatar-only trigger for the icon rail; otherwise avatar with name and email. */
  compact?: boolean;
}

export function UserMenu({ compact = false }: UserMenuProps) {
  const auth = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    setSignOutFailed(false);
    try {
      await auth.logout();
    } catch {
      setSignOutFailed(true);
    } finally {
      setSigningOut(false);
    }
  };

  const user = auth.status === 'authenticated' ? auth.user : null;

  return (
    <Menu width={240} position={compact ? 'right-end' : 'top-start'} shadow="md" withArrow>
      <Menu.Target>
        <UnstyledButton aria-label="User menu" className={classes.userButton} data-compact={compact || undefined}>
          <Avatar name={user ? (user.displayName ?? user.email) : undefined} color="initials" size={36} />
          {!compact && (
            <div className={classes.userText}>
              <Text size="sm" fw={600} truncate>
                {user ? (user.displayName ?? user.email) : 'Not signed in'}
              </Text>
              {user?.displayName && (
                <Text size="xs" c="dimmed" truncate>
                  {user.email}
                </Text>
              )}
            </div>
          )}
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>
          {user ? (
            <>
              <Text size="sm" fw={600} c="var(--mantine-color-text)" truncate>
                {user.displayName ?? user.email}
              </Text>
              {user.displayName && (
                <Text size="xs" c="dimmed" truncate>
                  {user.email}
                </Text>
              )}
            </>
          ) : (
            <Text size="sm" fw={600} c="var(--mantine-color-text)">
              Not signed in
            </Text>
          )}
        </Menu.Label>
        <Menu.Divider />
        <Menu.Item component={Link} to="/settings" leftSection={<IconSettings size={16} />}>
          Settings
        </Menu.Item>
        {user && (
          <Menu.Item
            color="red"
            leftSection={<IconLogout size={16} />}
            disabled={signingOut}
            closeMenuOnClick={false}
            onClick={() => void handleSignOut()}
          >
            Sign out
          </Menu.Item>
        )}
        {signOutFailed && (
          <Menu.Label c="red" role="alert">
            <IconAlertTriangle size={12} style={{ verticalAlign: '-1px' }} aria-hidden /> Sign out failed. Try again.
          </Menu.Label>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
