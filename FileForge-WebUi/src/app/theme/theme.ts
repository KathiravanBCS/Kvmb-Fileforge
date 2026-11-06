import { createTheme, ScrollArea } from '@mantine/core';

export const PRIMARY_COLORS = ['blue', 'indigo', 'violet', 'teal', 'green', 'orange', 'red', 'pink'] as const;

export type PrimaryColor = (typeof PRIMARY_COLORS)[number];

export const DEFAULT_PRIMARY_COLOR: PrimaryColor = 'indigo';

/** Mantine's ScrollArea defaults to 12px bars; the whole app uses slim ones (the native ones are set in scrollbars.css). */
export const SCROLLBAR_SIZE = 6;

export function isPrimaryColor(value: unknown): value is PrimaryColor {
  return PRIMARY_COLORS.some((color) => color === value);
}

export function createAppTheme(primaryColor: PrimaryColor) {
  return createTheme({
    primaryColor,
    defaultRadius: 'md',
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
    components: {
      ScrollArea: ScrollArea.extend({ defaultProps: { scrollbarSize: SCROLLBAR_SIZE } }),
      ScrollAreaAutosize: ScrollArea.Autosize.extend({ defaultProps: { scrollbarSize: SCROLLBAR_SIZE } }),
    },
    headings: {
      fontWeight: '600',
      sizes: {
        h1: { fontSize: 'clamp(1.75rem, 1.4rem + 1.2vw, 2.25rem)', lineHeight: '1.25' },
        h2: { fontSize: 'clamp(1.375rem, 1.2rem + 0.8vw, 1.75rem)', lineHeight: '1.3' },
        h3: { fontSize: 'clamp(1.125rem, 1.05rem + 0.4vw, 1.375rem)', lineHeight: '1.35' },
      },
    },
  });
}
