import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { capabilities } from '@/test/fixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import { validateUpload } from '../utils';
import { FilesPage } from './FilesPage';

vi.mock('@/lib/api');

// The personal OneDrive File Manager is kept as it was (reserved for a future premium feature). It had no frontend tests, so
// these pin its behaviour: what each workspace role sees, that it only talks to ITS OWN endpoints, and that the central
// storage work did not leak into it.
const oneDrive = vi.mocked(api.storage.oneDrive);

const listing = {
  path: '',
  truncated: false,
  items: [
    { name: 'invoices', type: 'folder' as const, size: 0, mimeType: null, modifiedAt: null, path: 'invoices' },
    { name: 'report.pdf', type: 'file' as const, size: 4096, mimeType: 'application/pdf', modifiedAt: '2026-11-04T10:00:00Z', path: 'report.pdf' },
  ],
};

function stub(role: string, status: 'connected' | 'not_connected' | 'consent_required' = 'connected') {
  vi.mocked(api.workspaces.list).mockResolvedValue([{ id: '1', name: 'Personal', type: 'personal', role }]);
  vi.mocked(api.centralStorage.capabilities).mockResolvedValue(capabilities());
  oneDrive.getStatus.mockResolvedValue({ status, connection: null });
  oneDrive.listItems.mockResolvedValue(listing);
}

beforeEach(() => stub('owner'));

describe('File Manager, connected', () => {
  it('lists the OneDrive folder and files from the workspace endpoints', async () => {
    renderWithProviders(<FilesPage />);
    expect(await screen.findByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('invoices')).toBeInTheDocument();
    expect(oneDrive.getStatus).toHaveBeenCalledWith('1', expect.anything());
    expect(oneDrive.listItems).toHaveBeenCalledWith('1', '', expect.anything());
    expect(screen.getByText('OneDrive connected')).toBeInTheDocument();
  });

  it('never touches central storage (apart from the permission answer every page gets)', async () => {
    renderWithProviders(<FilesPage />);
    await screen.findByText('report.pdf');
    const central = api.centralStorage;
    for (const call of [central.me.list, central.me.upload, central.me.usage, central.admin.list, central.admin.users, central.admin.connection.get]) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  it('the workspace owner can upload, rename and delete (as before)', async () => {
    renderWithProviders(<FilesPage />);
    await screen.findByText('report.pdf');
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename report.pdf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete report.pdf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download report.pdf' })).toBeInTheDocument();
  });

  it('an editor can upload and rename, but not delete', async () => {
    stub('editor');
    renderWithProviders(<FilesPage />);
    await screen.findByText('report.pdf');
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename report.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete report.pdf' })).not.toBeInTheDocument();
  });

  it('a viewer can only download', async () => {
    stub('viewer');
    renderWithProviders(<FilesPage />);
    await screen.findByText('report.pdf');
    expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename report.pdf' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete report.pdf' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download report.pdf' })).toBeInTheDocument();
  });

  it('downloads through its own download endpoint', async () => {
    oneDrive.download.mockResolvedValue(new Blob(['x']));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderWithProviders(<FilesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Download report.pdf' }));
    await waitFor(() => expect(oneDrive.download).toHaveBeenCalledWith('1', 'report.pdf'));
  });

  it('keeps its own 4 MB upload limit (central storage allows 50 MB; this feature does not)', () => {
    const file = (size: number) => Object.defineProperty(new File(['x'], 'a.pdf'), 'size', { value: size });
    expect(validateUpload(file(4 * 1024 * 1024))).toBeNull();
    expect(validateUpload(file(5 * 1024 * 1024))).toMatch(/Too large: files up to 4\.0 MB/);
  });
});

describe('File Manager, not connected', () => {
  it('offers the owner "Connect OneDrive" and starts the personal connection flow', async () => {
    stub('owner', 'not_connected');
    oneDrive.connect.mockResolvedValue('https://login.microsoftonline.com/x');
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    renderWithProviders(<FilesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Connect OneDrive' }));
    await waitFor(() => expect(oneDrive.connect).toHaveBeenCalledTimes(1));
    expect(oneDrive.connect.mock.calls[0]?.[0]).toBe('1'); // the personal workspace id: this flow is per workspace
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://login.microsoftonline.com/x'));
    vi.unstubAllGlobals();
  });

  it('asks a viewer to contact an owner instead of offering a connect button', async () => {
    stub('viewer', 'not_connected');
    renderWithProviders(<FilesPage />);
    expect(await screen.findByText('Connect your OneDrive')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect OneDrive' })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask a workspace owner or administrator/)).toBeInTheDocument();
  });
});
