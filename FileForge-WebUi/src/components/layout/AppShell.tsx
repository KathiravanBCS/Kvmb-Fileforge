import { AppShell as MantineAppShell } from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import { Outlet } from 'react-router-dom';

import { PreviewBanner } from '@/features/auth/components/PreviewBanner';
import { AbilityProvider } from '@/lib/casl/context';
import { AppHeader } from './AppHeader';
import { AppSidebar } from './AppSidebar';
import classes from './AppShell.module.css';
import { useSidebarCollapsed } from './useSidebarCollapsed';

const SIDEBAR_WIDTH = 264;
const SIDEBAR_COMPACT_WIDTH = 72;

export function AppShell() {
  const [mobileNavOpened, { toggle: toggleMobileNav, close: closeMobileNav }] = useDisclosure(false);
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  // Matches the `sm` breakpoint below: under it the sidebar is an overlay drawer that always shows labels.
  const isDesktop = useMediaQuery('(min-width: 48em)', true, { getInitialValueInEffect: false });
  const compact = isDesktop && collapsed;

  return (
    <AbilityProvider>
      <MantineAppShell
        header={{ height: 56, collapsed: isDesktop }}
        navbar={{
          width: compact ? SIDEBAR_COMPACT_WIDTH : SIDEBAR_WIDTH,
          breakpoint: 'sm',
          collapsed: { mobile: !mobileNavOpened },
        }}
        padding={{ base: 'md', sm: 'lg' }}
      >
        <a href="#main-content" className={classes.skipLink}>
          Skip to main content
        </a>
        <AppHeader mobileNavOpened={mobileNavOpened} onToggleMobileNav={toggleMobileNav} />
        <AppSidebar
          compact={compact}
          showToggle={isDesktop}
          onToggleCompact={() => setCollapsed((value) => !value)}
          onNavigate={closeMobileNav}
        />
        <MantineAppShell.Main id="main-content" tabIndex={-1} className={classes.main}>
          <PreviewBanner />
          <Outlet />
        </MantineAppShell.Main>
      </MantineAppShell>
    </AbilityProvider>
  );
}
