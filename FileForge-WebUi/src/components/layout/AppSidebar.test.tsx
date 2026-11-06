import { AppShell } from '@mantine/core';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-types';
import { capabilities } from '@/test/fixtures';
import { ADMIN, ALICE, renderWithProviders } from '@/test/renderWithProviders';
import { AppSidebar } from './AppSidebar';

vi.mock('@/lib/api');

const central = vi.mocked(api.centralStorage, { deep: true });

function renderSidebar(options: Parameters<typeof renderWithProviders>[1] = {}, compact = false) {
  return renderWithProviders(
    <AppShell navbar={{ width: 264, breakpoint: 'sm' }}>
      <AppSidebar compact={compact} showToggle onToggleCompact={() => undefined} onNavigate={() => undefined} />
    </AppShell>,
    options,
  );
}

/** The collapsible group's header button. */
const group = (name: string) => screen.findByRole('button', { name });
const openGroup = async (name: string) => {
  await userEvent.click(await group(name));
  return screen.getByRole('group', { name });
};

const links = () => screen.getAllByRole('link').map((link) => link.textContent);

beforeEach(() => {
  // Everyone owns a personal workspace: the sidebar must still not treat that as administrator status.
  vi.mocked(api.workspaces.list).mockResolvedValue([{ id: '1', name: 'Personal', type: 'personal', role: 'owner' }]);
});

describe('the sidebar, driven by the real ability provider', () => {
  it('groups File Manager and My Files under "Files", and shows no administrator group to an ordinary user', async () => {
    central.capabilities.mockResolvedValue(capabilities({ isSystemAdmin: false }));
    renderSidebar({ user: ALICE });

    const files = await openGroup('Files');
    expect(within(files).getByRole('link', { name: 'My Files' })).toHaveAttribute('href', '/my-files');
    expect(within(files).getByRole('link', { name: 'File Manager' })).toHaveAttribute('href', '/files');
    expect(screen.queryByRole('button', { name: 'Storage Admin' })).not.toBeInTheDocument();
    for (const name of ['Admin Storage', 'Storage Settings', 'Storage Recovery']) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
  });

  it('shows the administrator group only after the API confirms the user is a system administrator', async () => {
    central.capabilities.mockResolvedValue(capabilities({ isSystemAdmin: true }));
    renderSidebar({ user: ADMIN });

    const admin = await openGroup('Storage Admin');
    expect(within(admin).getByRole('link', { name: 'Admin Storage' })).toHaveAttribute('href', '/admin/storage');
    expect(within(admin).getByRole('link', { name: 'Storage Settings' })).toHaveAttribute(
      'href',
      '/admin/storage/settings',
    );
    expect(within(admin).getByRole('link', { name: 'Storage Recovery' })).toHaveAttribute(
      'href',
      '/admin/storage/recovery',
    );
    // My Files stays with the other file pages, not with the administration.
    expect(within(admin).queryByRole('link', { name: 'My Files' })).not.toBeInTheDocument();
    expect(within(await openGroup('Files')).getByRole('link', { name: 'My Files' })).toBeInTheDocument();
  });

  it('hides the administrator group while the answer is still loading (it never guesses "administrator")', async () => {
    central.capabilities.mockReturnValue(new Promise(() => undefined)); // never answers
    renderSidebar({ user: ADMIN });

    await screen.findByRole('link', { name: 'Dashboard' });
    expect(screen.queryByRole('button', { name: 'Storage Admin' })).not.toBeInTheDocument();
    expect(links()).not.toContain('Admin Storage');
  });

  it('hides it when the check fails', async () => {
    central.capabilities.mockRejectedValue(
      new ApiError('Unable to reach the FileForge API.', {
        isNetworkError: true,
      }),
    );
    renderSidebar({ user: ADMIN });

    await group('Files');
    expect(screen.queryByRole('button', { name: 'Storage Admin' })).not.toBeInTheDocument();
  });

  it('keeps every pre-existing entry', async () => {
    central.capabilities.mockResolvedValue(capabilities());
    renderSidebar({ user: ALICE });
    await openGroup('Files');
    for (const label of [
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
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });
});

describe('groups', () => {
  it('start closed, open and close on click, and say so to assistive technology', async () => {
    central.capabilities.mockResolvedValue(capabilities());
    renderSidebar({ user: ALICE, route: '/dashboard' });

    const header = await group('Files');
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'My Files' })).not.toBeInTheDocument(); // hidden while closed

    await userEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'My Files' })).toBeInTheDocument();

    await userEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'My Files' })).not.toBeInTheDocument();
  });

  it('are open when the page being shown belongs to them, and mark that page as current', async () => {
    central.capabilities.mockResolvedValue(capabilities({ isSystemAdmin: true }));
    renderSidebar({ user: ADMIN, route: '/admin/storage/recovery' });

    const header = await group('Storage Admin');
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Storage Recovery' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Storage Settings' })).not.toHaveAttribute('aria-current');
    expect(await group('Files')).toHaveAttribute('aria-expanded', 'false'); // the other group stays closed
  });

  it('in the icon rail a group is one icon that opens a menu of its pages', async () => {
    central.capabilities.mockResolvedValue(capabilities({ isSystemAdmin: true }));
    renderSidebar({ user: ADMIN, route: '/admin/storage' }, true);

    expect(screen.queryByRole('link', { name: 'My Files' })).not.toBeInTheDocument();
    await userEvent.click(await group('Storage Admin'));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Admin Storage' })).toHaveAttribute('href', '/admin/storage');
    expect(within(menu).getByRole('menuitem', { name: 'Admin Storage' })).toHaveAttribute('aria-current', 'page');
    expect(within(menu).getByRole('menuitem', { name: 'Storage Recovery' })).toHaveAttribute(
      'href',
      '/admin/storage/recovery',
    );
  });
});
