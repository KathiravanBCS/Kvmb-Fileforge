import { useId, useMemo, useState } from 'react';
import {
  ActionIcon,
  AppShell as MantineAppShell,
  Menu,
  ScrollArea,
  Stack,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconBolt, IconChevronDown, IconChevronRight, IconLayoutSidebar } from '@tabler/icons-react';
import { Link, useLocation } from 'react-router-dom';

import { findNavItem, groupNavItems, visibleNavItems, type NavItem, type SidebarEntry } from '@/app/router/navigation';
import { useAbility } from '@/lib/casl/hooks';
import classes from './AppSidebar.module.css';
import { UserMenu } from './UserMenu';

interface AppSidebarProps {
  /** Icon-only rail. Only meaningful on desktop; the mobile drawer always shows labels. */
  compact: boolean;
  /** The collapse toggle is hidden in the mobile drawer. */
  showToggle: boolean;
  onToggleCompact: () => void;
  onNavigate: () => void;
}

interface SidebarLinkProps {
  item: NavItem;
  active: boolean;
  compact: boolean;
  onNavigate: () => void;
}

function SidebarLink({ item, active, compact, onNavigate }: SidebarLinkProps) {
  const ItemIcon = item.icon;
  const link = (
    <UnstyledButton
      component={Link}
      to={item.path}
      className={classes.link}
      data-active={active || undefined}
      data-compact={compact || undefined}
      aria-current={active ? 'page' : undefined}
      aria-label={compact ? item.label : undefined}
      onClick={onNavigate}
    >
      <ItemIcon size={20} stroke={1.75} aria-hidden />
      {!compact && <span className={classes.label}>{item.label}</span>}
    </UnstyledButton>
  );

  return compact ? (
    <Tooltip label={item.label} position="right" withArrow>
      {link}
    </Tooltip>
  ) : (
    link
  );
}

interface SidebarGroupProps {
  group: Extract<SidebarEntry, { kind: 'group' }>;
  activePath: string | undefined;
  compact: boolean;
  onNavigate: () => void;
}

/**
 * Related pages under one entry. Expanded: a collapsible section (open while one of its pages is showing). Icon rail: one icon whose
 * pages appear in a menu on hover or focus.
 */
function SidebarGroup({ group, activePath, compact, onNavigate }: SidebarGroupProps) {
  const GroupIcon = group.icon;
  const hasActive = group.items.some((item) => item.path === activePath);
  const [opened, setOpened] = useState(hasActive);
  const panelId = useId();
  // Arriving at one of the group's pages (a link elsewhere, the browser's back button) opens it.
  const [wasActive, setWasActive] = useState(hasActive);
  if (hasActive !== wasActive) {
    setWasActive(hasActive);
    if (hasActive) setOpened(true);
  }

  if (compact) {
    return (
      <Menu position="right-start" trigger="click-hover" withArrow shadow="md" offset={8}>
        <Menu.Target>
          <Tooltip label={group.label} position="right" withArrow>
            <UnstyledButton
              className={classes.link}
              data-compact
              data-has-active={hasActive || undefined}
              aria-label={group.label}
            >
              <GroupIcon size={20} stroke={1.75} aria-hidden />
            </UnstyledButton>
          </Tooltip>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>{group.label}</Menu.Label>
          {group.items.map((item) => (
            <Menu.Item
              key={item.path}
              component={Link}
              to={item.path}
              data-active={item.path === activePath || undefined}
              aria-current={item.path === activePath ? 'page' : undefined}
              leftSection={<item.icon size={16} stroke={1.75} aria-hidden />}
              onClick={onNavigate}
            >
              {item.label}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    );
  }

  return (
    <div>
      <UnstyledButton
        className={classes.link}
        data-has-active={(hasActive && !opened) || undefined}
        aria-expanded={opened}
        aria-controls={opened ? panelId : undefined}
        onClick={() => setOpened((current) => !current)}
      >
        <GroupIcon size={20} stroke={1.75} aria-hidden />
        <span className={classes.groupLabel}>{group.label}</span>
        {opened ? (
          <IconChevronDown size={16} stroke={1.75} className={classes.chevron} aria-hidden />
        ) : (
          <IconChevronRight size={16} stroke={1.75} className={classes.chevron} aria-hidden />
        )}
      </UnstyledButton>
      {opened && (
        <Stack id={panelId} gap={1} mt={2} role="group" aria-label={group.label}>
          {group.items.map((item) => (
            <UnstyledButton
              key={item.path}
              component={Link}
              to={item.path}
              className={classes.childLink}
              data-active={item.path === activePath || undefined}
              aria-current={item.path === activePath ? 'page' : undefined}
              onClick={onNavigate}
            >
              <item.icon size={16} stroke={1.75} aria-hidden />
              <span className={classes.label}>{item.label}</span>
            </UnstyledButton>
          ))}
        </Stack>
      )}
    </div>
  );
}

export function AppSidebar({ compact, showToggle, onToggleCompact, onNavigate }: AppSidebarProps) {
  const { pathname } = useLocation();
  const activePath = findNavItem(pathname)?.path;
  // Administrator entries appear only when the API has confirmed the user is a system administrator.
  const ability = useAbility();
  const entries = useMemo(() => groupNavItems(visibleNavItems(ability)), [ability]);
  const toggleLabel = compact ? 'Expand sidebar' : 'Collapse sidebar';

  return (
    <MantineAppShell.Navbar aria-label="Main navigation">
      <div className={classes.sidebar}>
        <div className={classes.header} data-compact={compact || undefined}>
          {compact ? (
            // Icon rail: the brand mark doubles as the expand button, swapping to the toggle icon on hover/focus.
            <Tooltip label={toggleLabel} position="right" withArrow>
              <UnstyledButton className={classes.expandButton} aria-label={toggleLabel} onClick={onToggleCompact}>
                <ThemeIcon size={32} radius="md" className={classes.brandMark} aria-hidden>
                  <IconBolt size={18} />
                </ThemeIcon>
                <IconLayoutSidebar size={22} stroke={1.75} className={classes.toggleMark} aria-hidden />
              </UnstyledButton>
            </Tooltip>
          ) : (
            <>
              <div className={classes.brand}>
                <ThemeIcon size={32} radius="md" aria-hidden>
                  <IconBolt size={18} />
                </ThemeIcon>
                <span>FileForge AI</span>
              </div>
              {showToggle && (
                <Tooltip label={toggleLabel} withArrow>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="lg"
                    aria-label={toggleLabel}
                    onClick={onToggleCompact}
                  >
                    <IconLayoutSidebar size={20} stroke={1.75} />
                  </ActionIcon>
                </Tooltip>
              )}
            </>
          )}
        </div>

        <ScrollArea className={classes.links} type="auto" offsetScrollbars>
          <Stack gap={4} p="sm">
            {entries.map((entry) =>
              entry.kind === 'group' ? (
                <SidebarGroup
                  key={entry.id}
                  group={entry}
                  activePath={activePath}
                  compact={compact}
                  onNavigate={onNavigate}
                />
              ) : (
                <SidebarLink
                  key={entry.item.path}
                  item={entry.item}
                  active={entry.item.path === activePath}
                  compact={compact}
                  onNavigate={onNavigate}
                />
              ),
            )}
          </Stack>
        </ScrollArea>

        <div className={classes.footer} data-compact={compact || undefined}>
          <UserMenu compact={compact} />
        </div>
      </div>
    </MantineAppShell.Navbar>
  );
}
