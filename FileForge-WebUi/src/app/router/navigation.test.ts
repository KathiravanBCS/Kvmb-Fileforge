import { describe, expect, it } from 'vitest';

import { defineAbilityFor } from '@/lib/casl/ability';
import { NAV_ITEMS, findNavItem, visibleNavItems, groupNavItems } from './navigation';

const labels = (items: { label: string }[]) => items.map((item) => item.label);

describe('sidebar visibility', () => {
  it('an ordinary signed-in user sees My Files and the personal File Manager, but no administrator entries', () => {
    const items = labels(visibleNavItems(defineAbilityFor('owner', { signedIn: true })));
    expect(items).toContain('My Files');
    expect(items).toContain('File Manager');
    expect(items).not.toContain('Admin Storage');
    expect(items).not.toContain('Storage Settings');
    expect(items).not.toContain('Storage Recovery');
  });

  it('a workspace owner is still not shown administrator entries', () => {
    const items = labels(visibleNavItems(defineAbilityFor('owner', { signedIn: true, isSystemAdmin: false })));
    expect(items.filter((label) => label.startsWith('Admin') || label.startsWith('Storage '))).toEqual([]);
  });

  it('a verified system administrator sees the administrator entries too', () => {
    const items = labels(visibleNavItems(defineAbilityFor('owner', { signedIn: true, isSystemAdmin: true })));
    expect(items).toEqual(
      expect.arrayContaining(['My Files', 'Admin Storage', 'Storage Settings', 'Storage Recovery', 'File Manager']),
    );
  });

  it('while permissions are unknown (not signed in / loading), only the always-visible entries show', () => {
    const items = labels(visibleNavItems(defineAbilityFor(undefined)));
    expect(items).not.toContain('My Files');
    expect(items).not.toContain('Admin Storage');
    expect(items).toContain('Dashboard');
  });

  it('the existing entries and their order are unchanged', () => {
    const base = labels(NAV_ITEMS.filter((item) => !item.requires));
    expect(base).toEqual([
      'Dashboard',
      'Business Card Scanner',
      'PDF Processing',
      'QR Code Scanner',
      'Contacts',
      'Invoices',
      'Receipts',
      'Report Studio',
      'Email',
      'File Manager',
      'Settings',
    ]);
  });
});

describe('routes', () => {
  it('registers the central storage pages', () => {
    const paths = NAV_ITEMS.map((item) => item.path);
    expect(paths).toEqual(
      expect.arrayContaining(['/my-files', '/admin/storage', '/admin/storage/settings', '/admin/storage/recovery']),
    );
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('highlights the most specific entry: settings is not mistaken for Admin Storage', () => {
    expect(findNavItem('/admin/storage')?.label).toBe('Admin Storage');
    expect(findNavItem('/admin/storage/settings')?.label).toBe('Storage Settings');
    expect(findNavItem('/admin/storage/recovery')?.label).toBe('Storage Recovery');
    expect(findNavItem('/my-files')?.label).toBe('My Files');
    expect(findNavItem('/files')?.label).toBe('File Manager');
    expect(findNavItem('/nope')).toBeUndefined();
  });

  it('the personal File Manager route still points at its own page', () => {
    expect(NAV_ITEMS.find((item) => item.path === '/files')?.label).toBe('File Manager');
  });
});

describe('sidebar groups', () => {
  const shape = (ability: Parameters<typeof visibleNavItems>[0]) =>
    groupNavItems(visibleNavItems(ability)).map((entry) =>
      entry.kind === 'group' ? `${entry.label}: ${entry.items.map((item) => item.label).join(', ')}` : entry.item.label,
    );

  it('puts the file pages in one group and the storage administration in another', () => {
    const entries = shape(defineAbilityFor('owner', { signedIn: true, isSystemAdmin: true }));
    expect(entries).toContain('Files: File Manager, My Files');
    expect(entries).toContain('Storage Admin: Admin Storage, Storage Settings, Storage Recovery');
    // Only the groups collapse the menu: everything else is still a top-level entry.
    expect(entries).toEqual(expect.arrayContaining(['Dashboard', 'Email', 'Settings']));
    expect(entries.filter((entry) => ['File Manager', 'My Files', 'Admin Storage'].includes(entry))).toEqual([]);
  });

  it('an ordinary user has no administration group at all', () => {
    const entries = shape(defineAbilityFor('owner', { signedIn: true, isSystemAdmin: false }));
    expect(entries.some((entry) => entry.startsWith('Storage Admin'))).toBe(false);
    expect(entries).toContain('Files: File Manager, My Files');
  });

  it('a group sits where its first page was, and every page appears exactly once', () => {
    const items = visibleNavItems(defineAbilityFor('owner', { signedIn: true, isSystemAdmin: true }));
    const entries = groupNavItems(items);
    const labels = entries.flatMap((entry) =>
      entry.kind === 'group' ? entry.items.map((item) => item.label) : [entry.item.label],
    );
    expect(labels.sort()).toEqual(items.map((item) => item.label).sort());
    expect(entries.findIndex((entry) => entry.kind === 'group' && entry.id === 'files')).toBe(
      entries.findIndex((entry) => entry.kind === 'item' && entry.item.label === 'Email') + 1,
    );
  });
});
