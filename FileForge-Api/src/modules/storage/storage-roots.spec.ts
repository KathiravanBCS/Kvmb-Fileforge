import { ancestryUnder } from './storage-roots';

const PERSONAL = 'FileForge';
const CENTRAL = 'FileForge-Central';

describe('ancestryUnder: where a Graph item sits relative to a top-level folder', () => {
  it.each([
    ['/drive/root:/FileForge', 'inside'],
    ['/drive/root:/FileForge/invoices/2026', 'inside'],
    ['/drives/b!abc/root:/FileForge/a', 'inside'],
    ['/drive/root:/fileforge/a', 'inside'], // OneDrive is case-insensitive
    ['/drive/root:/FILEFORGE', 'inside'],
    ['/drive/root:/FileForge/%C3%A9t%C3%A9', 'inside'],
  ])('%s is inside FileForge', (path, expected) => expect(ancestryUnder(path, PERSONAL)).toBe(expected));

  it.each([
    ['/drive/root:/FileForge-Central', 'a prefix is not a boundary'],
    ['/drive/root:/FileForge-Central/users/1', 'the central storage root'],
    ['/drive/root:/fileforge-central/users/1', 'the central root, other case'],
    ['/drive/root:/FileForge%2DCentral/users/1', 'the central root, percent-encoded'],
    ['/drive/root:/FileForgeX/a', 'a lookalike folder'],
    ['/drive/root:/Documents/FileForge/a', 'FileForge nested somewhere else'],
    ['/drive/root:', 'directly in the drive root'],
    ['/drive/root:/', 'directly in the drive root'],
  ])('%s is outside FileForge (%s)', (path) => expect(ancestryUnder(path, PERSONAL)).toBe('outside'));

  it.each([undefined, '', '/drive/items/ABC', '/drive/root:/Fi%ZZle'])(
    'says "unknown" (never "inside") when Graph gives no readable path: %s',
    (path) => expect(ancestryUnder(path, PERSONAL)).toBe('unknown'),
  );

  it('is symmetrical: central items are inside the central root and outside the personal one', () => {
    expect(ancestryUnder('/drive/root:/FileForge-Central/users/1', CENTRAL)).toBe('inside');
    expect(ancestryUnder('/drive/root:/FileForge/a', CENTRAL)).toBe('outside');
  });
});
