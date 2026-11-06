import type { ReactNode } from 'react';
import { Text, UnstyledButton } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';

import classes from './OptionCard.module.css';

interface OptionCardProps {
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
  /** The picture shown above the label. */
  preview: ReactNode;
}

/** One choice in a radio-style group of preview cards. Wrap a set of them in `role="radiogroup"`. */
export function OptionCard({ label, description, selected, onSelect, preview }: OptionCardProps) {
  return (
    <UnstyledButton role="radio" aria-checked={selected} className={classes.card} onClick={onSelect}>
      <div className={classes.preview} data-selected={selected || undefined}>
        {preview}
        {selected && (
          <span className={classes.check} aria-hidden>
            <IconCheck size={12} stroke={3} />
          </span>
        )}
      </div>
      <Text size="sm" fw={600} mt="xs">
        {label}
      </Text>
      <Text size="xs" c="dimmed">
        {description}
      </Text>
    </UnstyledButton>
  );
}
