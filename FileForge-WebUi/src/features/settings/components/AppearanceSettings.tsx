import { useState } from 'react';
import { Button, ColorSwatch, Group, SimpleGrid, useMantineColorScheme, type MantineColorScheme } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';

import { PRIMARY_COLORS, type PrimaryColor } from '@/app/theme/theme';
import { useSidebarCollapsed } from '@/components/layout/useSidebarCollapsed';
import { useThemeStore } from '@/app/store/themeStore';
import { AppPreview } from './AppPreview';
import { OptionCard } from './OptionCard';
import { SettingsRow, SettingsSection } from './SettingsRow';

const SCHEMES: { value: MantineColorScheme; label: string; description: string }[] = [
  { value: 'light', label: 'Light', description: 'Bright and clear.' },
  { value: 'dark', label: 'Dark', description: 'Easy on the eyes.' },
  { value: 'auto', label: 'System', description: 'Follow your device.' },
];

const SIDEBARS: { collapsed: boolean; label: string; description: string }[] = [
  { collapsed: false, label: 'Expanded', description: 'Icons with labels.' },
  { collapsed: true, label: 'Compact', description: 'Icons only.' },
];

export function AppearanceSettings() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const primaryColor = useThemeStore((state) => state.primaryColor);
  const setPrimaryColor = useThemeStore((state) => state.setPrimaryColor);
  const [sidebarCollapsed, setSidebarCollapsed] = useSidebarCollapsed();

  // Edits are held as a draft and only applied on Save; Cancel discards them.
  const [scheme, setScheme] = useState<MantineColorScheme>(colorScheme);
  const [accent, setAccent] = useState<PrimaryColor>(primaryColor);
  const [collapsed, setCollapsed] = useState(sidebarCollapsed);

  const dirty = scheme !== colorScheme || accent !== primaryColor || collapsed !== sidebarCollapsed;

  const handleSave = () => {
    setColorScheme(scheme);
    setPrimaryColor(accent);
    setSidebarCollapsed(collapsed);
  };

  const handleCancel = () => {
    setScheme(colorScheme);
    setAccent(primaryColor);
    setCollapsed(sidebarCollapsed);
  };

  return (
    <SettingsSection title="Appearance" description="Change how FileForge looks and feels on this device.">
      <SettingsRow label="Theme" description="Choose a light or dark interface.">
        <SimpleGrid cols={{ base: 1, xs: 3 }} role="radiogroup" aria-label="Theme">
          {SCHEMES.map(({ value, label, description }) => (
            <OptionCard
              key={value}
              label={label}
              description={description}
              selected={scheme === value}
              onSelect={() => setScheme(value)}
              preview={<AppPreview tone={value === 'auto' ? 'system' : value} />}
            />
          ))}
        </SimpleGrid>
      </SettingsRow>

      <SettingsRow label="Accent color" description="Used for buttons, links and highlights.">
        <Group gap="xs" role="radiogroup" aria-label="Accent color">
          {PRIMARY_COLORS.map((color) => (
            <ColorSwatch
              key={color}
              component="button"
              type="button"
              role="radio"
              color={`var(--mantine-color-${color}-6)`}
              size={28}
              aria-label={color}
              aria-checked={color === accent}
              onClick={() => setAccent(color)}
              style={{ cursor: 'pointer', color: 'white' }}
            >
              {color === accent && <IconCheck size={14} aria-hidden />}
            </ColorSwatch>
          ))}
        </Group>
      </SettingsRow>

      <SettingsRow label="Sidebar" description="How the navigation sidebar opens by default.">
        <SimpleGrid cols={{ base: 1, xs: 3 }} role="radiogroup" aria-label="Sidebar">
          {SIDEBARS.map(({ collapsed: value, label, description }) => (
            <OptionCard
              key={label}
              label={label}
              description={description}
              selected={collapsed === value}
              onSelect={() => setCollapsed(value)}
              preview={<AppPreview tone="light" rail={value} />}
            />
          ))}
        </SimpleGrid>
      </SettingsRow>

      <Group justify="flex-end" gap="sm" pt="lg">
        <Button variant="default" disabled={!dirty} onClick={handleCancel}>
          Cancel
        </Button>
        <Button disabled={!dirty} onClick={handleSave}>
          Save changes
        </Button>
      </Group>
    </SettingsSection>
  );
}
