import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-types';
import { adminFile, capabilities, file, page, users } from '@/test/fixtures';
import { ADMIN, ALICE, renderWithProviders } from '@/test/renderWithProviders';
import { AdminStoragePage } from './AdminStoragePage';

vi.mock('@/lib/api');

const central = vi.mocked(api.centralStorage, { deep: true });

function stubApi({ isSystemAdmin = true, available = true }: { isSystemAdmin?: boolean; available?: boolean } = {}) {
  // Everybody owns a personal workspace: this is what a NON-administrator looks like to the workspace API.
  vi.mocked(api.workspaces.list).mockResolvedValue([{ id: '1', name: 'Personal', type: 'personal', role: 'owner' }]);
  central.capabilities.mockResolvedValue(capabilities({ isSystemAdmin, available }));
  central.admin.list.mockResolvedValue(page([adminFile(), file({ id: '12', name: 'my-own.pdf', ownerId: '1', uploadedById: '1', owner: { id: '1', displayName: 'Admin', email: 'admin@example.com' } })]));
  central.admin.users.mockResolvedValue(users);
  central.admin.totalUsage.mockResolvedValue({ total: { fileCount: 2, totalBytes: 6144 }, perUser: users.filter((user) => user.fileCount > 0) });
}

const renderAsAdmin = () => renderWithProviders(<AdminStoragePage />, { user: ADMIN });
const adminCalls = () => [central.admin.list, central.admin.users, central.admin.totalUsage, central.admin.connection.get, central.admin.upload];

beforeEach(() => stubApi());

describe('who can open Admin Storage', () => {
  it('shows an explanation to an ordinary user, who is also a workspace owner, and requests no administrator data', async () => {
    stubApi({ isSystemAdmin: false });
    renderWithProviders(<AdminStoragePage />, { user: ALICE });

    expect(await screen.findByText('Administrators only')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Admin Storage' })).not.toBeInTheDocument();
    for (const call of adminCalls()) expect(call).not.toHaveBeenCalled();
  });

  it('does not trust a failed permission check: it asks again instead of showing administrator tools', async () => {
    central.capabilities.mockRejectedValueOnce(new ApiError('Unable to reach the FileForge API.', { isNetworkError: true }));
    renderAsAdmin();

    expect(await screen.findByText('We couldn’t check your permissions')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Admin Storage' })).not.toBeInTheDocument();
    for (const call of adminCalls()) expect(call).not.toHaveBeenCalled();

    central.capabilities.mockResolvedValue(capabilities({ isSystemAdmin: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Admin Storage' })).toBeInTheDocument();
  });

  it('is gated by the API’s answer only: a "system admin" claim anywhere else changes nothing', async () => {
    stubApi({ isSystemAdmin: false });
    // Even a user whose id looks like the first administrator's gets nothing without the API's confirmation.
    renderWithProviders(<AdminStoragePage />, { user: ADMIN });
    expect(await screen.findByText('Administrators only')).toBeInTheDocument();
    for (const call of adminCalls()) expect(call).not.toHaveBeenCalled();
  });
});

describe('Admin Storage (a system administrator)', () => {
  it('lists every user’s files with their owners, through the administrator API', async () => {
    renderAsAdmin();

    expect(await screen.findByText('bob-report.pdf')).toBeInTheDocument();
    expect(screen.getByText('my-own.pdf')).toBeInTheDocument();
    expect(central.admin.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, sort: 'date', order: 'desc' }), expect.anything());
    expect(central.me.list).not.toHaveBeenCalled();
    expect(screen.getByText('Owner')).toBeInTheDocument(); // the owner column
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });

  it('links to the recovery page and to the storage settings', async () => {
    renderAsAdmin();
    await screen.findByText('bob-report.pdf');
    expect(screen.getByRole('link', { name: 'Recovery' })).toHaveAttribute('href', '/admin/storage/recovery');
    expect(screen.getByRole('link', { name: 'Storage settings' })).toHaveAttribute('href', '/admin/storage/settings');
  });

  it('shows total storage and the number of users with files', async () => {
    renderAsAdmin();
    const total = await screen.findByLabelText('Total storage in use');
    await waitFor(() => expect(total).toHaveTextContent('6.0 KB'));
    expect(total).toHaveTextContent('2 files');
    await waitFor(() => expect(screen.getByLabelText('Users with files')).toHaveTextContent('2'));
  });

  it('shows per-user usage and jumps to a user’s files', async () => {
    renderAsAdmin();
    await screen.findByText('bob-report.pdf');

    await userEvent.click(screen.getByRole('tab', { name: 'Usage by user' }));
    const row = await screen.findByText('bob@example.com');
    expect(row).toBeInTheDocument();
    expect(screen.getByText('4.0 KB')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'View files of bob@example.com' }));

    await waitFor(() => expect(central.admin.list).toHaveBeenLastCalledWith(expect.objectContaining({ ownerUserId: '3' }), expect.anything()));
    expect(await screen.findByRole('tab', { name: 'Files', selected: true })).toBeInTheDocument();
    expect(screen.getByText(/Owner: Bob/)).toBeInTheDocument();
  });

  it('filters by owner and can remove that filter', async () => {
    renderAsAdmin();
    await screen.findByText('bob-report.pdf');

    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by owner' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Bob (bob@example.com)' }));

    await waitFor(() => expect(central.admin.list).toHaveBeenLastCalledWith(expect.objectContaining({ ownerUserId: '3', page: 1 }), expect.anything()));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove owner filter' }));
    await waitFor(() => expect(central.admin.list).toHaveBeenLastCalledWith(expect.not.objectContaining({ ownerUserId: '3' }), expect.anything()));
  });

  it('searches across all users', async () => {
    renderAsAdmin();
    await screen.findByText('bob-report.pdf');
    await userEvent.type(screen.getByRole('searchbox'), 'bob');
    await waitFor(() => expect(central.admin.list).toHaveBeenCalledWith(expect.objectContaining({ search: 'bob' }), expect.anything()));
  });

  it('shows another user’s file details including the owner', async () => {
    renderAsAdmin();
    await userEvent.click(await screen.findByRole('button', { name: 'Details of bob-report.pdf' }));
    const drawer = await screen.findByRole('dialog', { name: 'File details' });
    expect(within(drawer).getByText('Owner')).toBeInTheDocument();
    expect(within(drawer).getByText('bob@example.com')).toBeInTheDocument();
  });
});

describe('administrator actions on other users’ files are confirmed and say they are audited', () => {
  it('deleting another user’s file names the owner, warns it is audited, and calls the administrator API', async () => {
    central.admin.remove.mockResolvedValue(undefined);
    renderAsAdmin();
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for bob-report.pdf' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete file?' });
    expect(within(dialog).getByText(/owned by Bob/)).toBeInTheDocument();
    expect(within(dialog).getByText(/recorded in the audit trail/)).toBeInTheDocument();
    expect(central.admin.remove).not.toHaveBeenCalled(); // nothing until confirmed

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(central.admin.remove).toHaveBeenCalledWith('11'));
    expect(central.me.remove).not.toHaveBeenCalled();
    expect(await screen.findByText('File deleted')).toBeInTheDocument();
    expect(await screen.findByText(/bob-report\.pdf · recorded in the audit trail/)).toBeInTheDocument();
  });

  it('deleting the administrator’s OWN file carries no audit wording', async () => {
    renderAsAdmin();
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for my-own.pdf' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete file?' });
    expect(within(dialog).queryByText(/audit trail/)).not.toBeInTheDocument();
  });

  it('renaming another user’s file says so, and uses the administrator API', async () => {
    central.admin.rename.mockResolvedValue(adminFile({ name: 'renamed.pdf' }));
    renderAsAdmin();
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for bob-report.pdf' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename file' });
    expect(within(dialog).getByText(/another user’s file/)).toBeInTheDocument();

    const input = within(dialog).getByLabelText(/New name/);
    await userEvent.clear(input);
    await userEvent.type(input, 'renamed.pdf');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(central.admin.rename).toHaveBeenCalledWith('11', 'renamed.pdf'));
  });

  it('replacing another user’s file content warns it is audited', async () => {
    renderAsAdmin();
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for bob-report.pdf' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Replace content' }));
    const dialog = await screen.findByRole('dialog', { name: 'Replace file content' });
    expect(within(dialog).getByText(/recorded in the audit trail/)).toBeInTheDocument();
  });
});

describe('upload for a selected user', () => {
  it('cannot upload until a user is chosen, then sends the file to THAT user through the administrator API', async () => {
    central.admin.upload.mockResolvedValue(adminFile({ name: 'for-bob.pdf' }));
    renderAsAdmin();
    await userEvent.click(await screen.findByRole('button', { name: 'Upload for user' }));
    const dialog = await screen.findByRole('dialog', { name: 'Upload files for a user' });

    // No user yet: the drop area is disabled and nothing is sent.
    expect(within(dialog).getByText('Choose a user first.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Choose files to upload'), { target: { files: [new File(['x'], 'early.pdf')] } });
    expect(central.admin.upload).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('combobox', { name: /Upload for/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Bob (bob@example.com)' }));
    expect(within(dialog).getByText(/recorded in the audit trail under your name/)).toBeInTheDocument();

    const picked = new File(['%PDF-'], 'for-bob.pdf');
    fireEvent.change(within(dialog).getByLabelText('Choose files to upload'), { target: { files: [picked] } });

    await waitFor(() => expect(central.admin.upload).toHaveBeenCalledTimes(1));
    expect(central.admin.upload.mock.calls[0]?.[0]).toBe('3'); // Bob's id
    expect(central.admin.upload.mock.calls[0]?.[1]).toBe(picked);
    expect(central.me.upload).not.toHaveBeenCalled();
    expect(await screen.findByText('File uploaded')).toBeInTheDocument();
    expect(await screen.findByText(/Uploads for other users are recorded in the audit trail/)).toBeInTheDocument();
  });

  it('starts with the owner filter pre-selected when one is active', async () => {
    renderAsAdmin();
    await screen.findByText('bob-report.pdf');
    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by owner' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Bob (bob@example.com)' }));

    await userEvent.click(screen.getByRole('button', { name: 'Upload for user' }));
    const dialog = await screen.findByRole('dialog', { name: 'Upload files for a user' });
    expect(within(dialog).getByRole('combobox', { name: /Upload for/ })).toHaveValue('Bob (bob@example.com)');
  });
});

describe('when central storage is not connected', () => {
  beforeEach(() => stubApi({ available: false }));

  it('explains it to the administrator, with the way to fix it', async () => {
    renderAsAdmin();
    expect(await screen.findByText('File storage isn’t available right now')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open storage settings' })).toHaveAttribute('href', '/admin/storage/settings');
  });

  it('disables uploading and opening files, but not looking at or renaming them', async () => {
    renderAsAdmin();
    expect(await screen.findByText('bob-report.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload for user' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download bob-report.pdf' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'More actions for bob-report.pdf' }));
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: 'Replace content' })).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: 'Rename' })).not.toHaveAttribute('data-disabled');
  });
});
