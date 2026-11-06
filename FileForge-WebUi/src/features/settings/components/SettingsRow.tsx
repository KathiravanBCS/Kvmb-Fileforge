import type { ReactNode } from 'react';
import { Text, Title } from '@mantine/core';

import classes from './SettingsRow.module.css';

interface SettingsSectionProps {
  title: string;
  description: string;
  children: ReactNode;
}

/** A tab panel body: a heading, then label/control rows separated by dividers. */
export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <section>
      <div className={classes.sectionHeader}>
        <Title order={2} size="h4">
          {title}
        </Title>
        <Text size="sm" c="dimmed">
          {description}
        </Text>
      </div>
      {children}
    </section>
  );
}

interface SettingsRowProps {
  label: string;
  description?: string;
  children: ReactNode;
}

/** Label and help text on the left, the control on the right; stacked on narrow screens. */
export function SettingsRow({ label, description, children }: SettingsRowProps) {
  return (
    <div className={classes.row}>
      <div>
        <Text size="sm" fw={600}>
          {label}
        </Text>
        {description && (
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}
