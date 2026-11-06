import { describe, expect, it } from 'vitest';

import { createAppTheme, SCROLLBAR_SIZE } from './theme';

describe('the app theme', () => {
  it('gives every Mantine scroll area a slim scrollbar', () => {
    const { components } = createAppTheme('indigo');
    expect(SCROLLBAR_SIZE).toBeLessThan(12); // Mantine's own default
    expect(components?.ScrollArea?.defaultProps).toMatchObject({ scrollbarSize: SCROLLBAR_SIZE });
    expect(components?.ScrollAreaAutosize?.defaultProps).toMatchObject({ scrollbarSize: SCROLLBAR_SIZE });
  });
});
