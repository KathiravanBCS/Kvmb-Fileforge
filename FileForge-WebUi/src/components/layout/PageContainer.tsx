import type { ReactNode } from 'react';
import { Anchor, Group, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconBolt, IconChevronRight } from '@tabler/icons-react';
import { Link } from 'react-router-dom';

import { HOME_PATH } from '@/app/router/paths';
import { PageHeader, type PageHeaderProps } from './PageHeader';

export interface Crumb {
  label: string;
  /** Makes the crumb a link. The last crumb is the current location and is never one. */
  onClick?: () => void;
}

interface PageContainerProps extends PageHeaderProps {
  /** The trail after the brand icon. Defaults to just the page title; pass more for nested locations. */
  breadcrumbs?: Crumb[];
  /** Right side of the breadcrumb strip at the very top, e.g. a search box and quick-action buttons. */
  topActions?: ReactNode;
  /** Left side of the filter row under the title, e.g. dropdown filter buttons. */
  toolbar?: ReactNode;
  /** Right side of the filter row, e.g. a "Clear all filters" button. */
  toolbarEnd?: ReactNode;
  children: ReactNode;
}

/**
 * The one layout every page renders in, top to bottom:
 * breadcrumb strip (+ `topActions`) → title row (+ `actions`) → filter row (`toolbar` / `toolbarEnd`) → content.
 * The surrounding shell supplies the tinted background, so content blocks should be bordered `Paper`s.
 */
export function PageContainer({ children, breadcrumbs, topActions, toolbar, toolbarEnd, ...header }: PageContainerProps) {
  const trail = breadcrumbs ?? [{ label: header.title }];

  return (
    <Stack gap="lg">
      <Group justify="space-between" wrap="nowrap" mih={36}>
        <Group component="nav" aria-label="Breadcrumb" gap={8} wrap="nowrap" miw={0}>
          <UnstyledButton component={Link} to={HOME_PATH} aria-label="Home">
            <ThemeIcon size={24} radius="md" aria-hidden>
              <IconBolt size={14} />
            </ThemeIcon>
          </UnstyledButton>
          {trail.map((crumb, index) => (
            <Group key={`${index}-${crumb.label}`} gap={8} wrap="nowrap" miw={0}>
              <IconChevronRight size={14} color="var(--mantine-color-dimmed)" aria-hidden />
              {index === trail.length - 1 ? (
                <Text size="sm" fw={600} truncate aria-current="page">
                  {crumb.label}
                </Text>
              ) : (
                <Anchor component="button" type="button" size="sm" c="dimmed" onClick={crumb.onClick}>
                  {crumb.label}
                </Anchor>
              )}
            </Group>
          ))}
        </Group>
        {topActions && (
          <Group gap="xs" wrap="nowrap">
            {topActions}
          </Group>
        )}
      </Group>

      <PageHeader {...header} />

      {(toolbar || toolbarEnd) && (
        <Group justify="space-between" gap="xs">
          <Group gap="xs">{toolbar}</Group>
          {toolbarEnd && <Group gap="xs">{toolbarEnd}</Group>}
        </Group>
      )}

      {children}
    </Stack>
  );
}
