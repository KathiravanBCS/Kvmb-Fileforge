import { AppShell as MantineAppShell, Burger, Group, ThemeIcon } from '@mantine/core';
import { IconBolt } from '@tabler/icons-react';

interface AppHeaderProps {
  mobileNavOpened: boolean;
  onToggleMobileNav: () => void;
}

// Mobile only: the sidebar is an overlay drawer under `sm`, so it needs a trigger. Desktop has no top bar.
export function AppHeader({ mobileNavOpened, onToggleMobileNav }: AppHeaderProps) {
  return (
    <MantineAppShell.Header hiddenFrom="sm">
      <Group h="100%" px="md" gap="sm" wrap="nowrap">
        <Burger
          opened={mobileNavOpened}
          onClick={onToggleMobileNav}
          size="sm"
          aria-label="Toggle navigation"
          aria-expanded={mobileNavOpened}
        />
        <ThemeIcon size={28} radius="md" aria-hidden>
          <IconBolt size={16} />
        </ThemeIcon>
        <span style={{ fontWeight: 700 }}>FileForge AI</span>
      </Group>
    </MantineAppShell.Header>
  );
}
