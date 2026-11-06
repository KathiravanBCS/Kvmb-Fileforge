import { useLocalStorage } from '@mantine/hooks';

// Shared by the app shell and the Settings page so both read and write the same persisted value.
export function useSidebarCollapsed() {
  return useLocalStorage({
    key: 'fileforge-sidebar-collapsed',
    defaultValue: false,
    getInitialValueInEffect: false,
  });
}
