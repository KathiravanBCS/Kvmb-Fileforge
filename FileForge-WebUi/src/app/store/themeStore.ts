import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { DEFAULT_PRIMARY_COLOR, isPrimaryColor, type PrimaryColor } from '@/app/theme/theme';

// Light/dark/system is persisted by Mantine's color scheme manager; only the accent color needs a store.
interface ThemeState {
  primaryColor: PrimaryColor;
  setPrimaryColor: (color: PrimaryColor) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      primaryColor: DEFAULT_PRIMARY_COLOR,
      setPrimaryColor: (primaryColor) => set({ primaryColor }),
    }),
    {
      name: 'fileforge-theme',
      version: 1,
      partialize: ({ primaryColor }) => ({ primaryColor }),
      // Ignore a stored color that is no longer a supported palette name.
      merge: (persisted, current) => {
        const stored = (persisted as Partial<ThemeState> | undefined)?.primaryColor;
        return { ...current, primaryColor: isPrimaryColor(stored) ? stored : current.primaryColor };
      },
    },
  ),
);
