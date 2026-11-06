import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-types';
import { capabilities, file, page } from '@/test/fixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import { MyFilesPage } from './MyFilesPage';

vi.mock('@/lib/api');

const central = vi.mocked(api.centralStorage, { deep: true });
const MB = 1024 * 1024;

function stubApi({ available = true, files = [file()] }: { available?: boolean; files?: ReturnType<typeof file>[] } = {}) {
  vi.mocked(api.workspaces.list).mockResolvedValue([{ id: '1', name: 'Alice workspace', type: 'personal', role: 'owner' }]);
  central.capabilities.mockResolvedValue(capabilities({ available }));
  central.me.list.mockResolvedValue(page(files));
  central.me.usage.mockResolvedValue({ fileCount: files.length, totalBytes: files.reduce((sum, f) => sum + f.size, 0) });
}

const sized = (name: string, size: number) => {
  const picked = new File(['x'], name);
  Object.defineProperty(picked, 'size', { value: size });
  return picked;
};

beforeEach(() => stubApi());

describe('My Files', () => {
  it('lists the signed-in user’s own files through the own-files API only', async () => {
    renderWithProviders(<MyFilesPage />);

    expect(await screen.findByText('invoice.pdf')).toBeInTheDocument();
    expect(central.me.list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 25, sort: 'date', order: 'desc' }),
      expect.anything(),
    );
    // Nothing administrative is ever requested from this page.
    for (const call of [central.admin.list, central.admin.users, central.admin.totalUsage, central.admin.connection.get]) {
      expect(call).not.toHaveBeenCalled();
    }
    expect(screen.getByRole('heading', { name: 'My Files' })).toBeInTheDocument();
  });

  it('shows the user’s storage usage', async () => {
    renderWithProviders(<MyFilesPage />);
    const card = await screen.findByLabelText('Your storage');
    await waitFor(() => expect(card).toHaveTextContent('2.0 KB'));
    expect(card).toHaveTextContent('1 file');
  });

  it('offers no personal OneDrive connection (that belongs to the File Manager)', async () => {
    renderWithProviders(<MyFilesPage />);
    await screen.findByText('invoice.pdf');
    expect(screen.queryByText(/connect onedrive/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect/i })).not.toBeInTheDocument();
  });

  it('does not show administrator-only controls (owner column, upload for user)', async () => {
    renderWithProviders(<MyFilesPage />);
    await screen.findByText('invoice.pdf');
    expect(screen.queryByText('Owner')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload for user/i })).not.toBeInTheDocument();
  });

  it('shows a loading state, then an empty state with the way to add a file', async () => {
    stubApi({ files: [] });
    renderWithProviders(<MyFilesPage />);
    expect(await screen.findByText('No files yet')).toBeInTheDocument();
    expect(screen.getByText(/Drag files onto the upload area/i)).toBeInTheDocument();
  });

  it('shows the error with a retry when the list cannot be loaded', async () => {
    central.me.list.mockRejectedValueOnce(new ApiError('The server is having trouble.', { status: 503 }));
    renderWithProviders(<MyFilesPage />);
    expect(await screen.findByText(/The server is having trouble/)).toBeInTheDocument();

    central.me.list.mockResolvedValue(page([file({ name: 'back-again.pdf' })]));
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(await screen.findByText('back-again.pdf')).toBeInTheDocument();
  });

  it('asks for sign-in instead of calling the API when there is no session', async () => {
    renderWithProviders(<MyFilesPage />, { user: null });
    expect(await screen.findByText('Sign in to see your files')).toBeInTheDocument();
    expect(central.me.list).not.toHaveBeenCalled();
  });
});

describe('searching, filtering and paging are done by the server', () => {
  it('searches: typing asks the server for matching files (page 1)', async () => {
    renderWithProviders(<MyFilesPage />);
    await screen.findByText('invoice.pdf');

    await userEvent.type(screen.getByRole('searchbox'), 'report');

    await waitFor(() => expect(central.me.list).toHaveBeenCalledWith(expect.objectContaining({ search: 'report', page: 1 }), expect.anything()));
    expect(await screen.findByRole('button', { name: 'Remove search filter' })).toBeInTheDocument();
  });

  it('filters by file type', async () => {
    renderWithProviders(<MyFilesPage />);
    await screen.findByText('invoice.pdf');

    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by file type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'PDF' }));

    await waitFor(() => expect(central.me.list).toHaveBeenCalledWith(expect.objectContaining({ type: 'pdf' }), expect.anything()));
  });

  it('clears every filter with one button', async () => {
    renderWithProviders(<MyFilesPage />);
    await screen.findByText('invoice.pdf');
    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by file type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'PDF' }));
    await screen.findByRole('button', { name: 'Clear all filters' });

    await userEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));

    await waitFor(() => expect(central.me.list).toHaveBeenLastCalledWith(expect.not.objectContaining({ type: 'pdf' }), expect.anything()));
    expect(screen.queryByRole('button', { name: 'Clear all filters' })).not.toBeInTheDocument();
  });

  it('says "no matching files" (not "no files") when a filter matches nothing', async () => {
    renderWithProviders(<MyFilesPage />);
    await screen.findByText('invoice.pdf');
    central.me.list.mockResolvedValue(page([]));

    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by file type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Archives' }));

    expect(await screen.findByText('No matching files')).toBeInTheDocument();
  });
});

describe('uploading', () => {
  it('uploads a chosen file as the signed-in user (no target user is ever sent), with progress and a result', async () => {
    let finish: (value: ReturnType<typeof file>) => void = () => undefined;
    central.me.upload.mockImplementation(
      (_file, options) =>
        new Promise((resolve) => {
          options?.onProgress?.(0.5);
          finish = resolve;
        }),
    );
    renderWithProviders(<MyFilesPage />);
    await screen.findByText('invoice.pdf');

    const picked = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('Choose files to upload'), { target: { files: [picked] } });

    expect(await screen.findByText('notes.txt')).toBeInTheDocument();
    expect(await screen.findByText('50%')).toBeInTheDocument();
    expect(central.me.upload).toHaveBeenCalledTimes(1);
    expect(central.me.upload.mock.calls[0]?.[0]).toBe(picked);
    expect(central.admin.upload).not.toHaveBeenCalled();

    finish(file({ id: '99', name: 'notes.txt' }));
    expect(await within(screen.getByRole('region', { name: 'Uploads' })).findByText('Uploaded')).toBeInTheDocument();
    expect(await screen.findByText('File uploaded')).toBeInTheDocument(); // the summary toast
  });

  it('accepts a file dropped on the upload area', async () => {
    central.me.upload.mockResolvedValue(file({ name: 'dropped.pdf' }));
    renderWithProviders(<MyFilesPage />);
    await screen.findByText('invoice.pdf');

    const dropped = new File(['x'], 'dropped.pdf');
    fireEvent.drop(screen.getByRole('button', { name: /Upload files/ }), { dataTransfer: { files: [dropped] } });

    await waitFor(() => expect(central.me.upload).toHaveBeenCalledTimes(1));
    expect(central.me.upload.mock.calls[0]?.[0]).toBe(dropped);
  });

  it.each([
    ['a file over 50 MB', () => sized('huge.pdf', 51 * MB), /Too large: files up to 50 MB/],
    ['an empty file', () => sized('empty.txt', 0), /The file is empty/],
    ['a program', () => sized('setup.exe', 100), /cannot be stored here/],
  ])('rejects %s before any request is made', async (_label, make, message) => {
    renderWithProviders(<MyFilesPage />);
    await screen.findByText('invoice.pdf');

    fireEvent.change(screen.getByLabelText('Choose files to upload'), { target: { files: [make()] } });

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(central.me.upload).not.toHaveBeenCalled();
  });

  it('lets the user cancel a running upload: the request is aborted and the file is marked cancelled', async () => {
    let signal: AbortSignal | undefined;
    central.me.upload.mockImplementation(
      (_file, options) =>
        new Promise((_resolve, reject) => {
          signal = options?.signal;
          options?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('canceled'), { name: 'CanceledError' })));
        }),
    );
    renderWithProviders(<MyFilesPage />);
    await screen.findByText('invoice.pdf');
    fireEvent.change(screen.getByLabelText('Choose files to upload'), { target: { files: [new File(['x'], 'slow.pdf')] } });

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel upload of slow.pdf' }));

    await waitFor(() => expect(signal?.aborted).toBe(true));
    const queue = within(screen.getByRole('region', { name: 'Uploads' }));
    expect(await queue.findByText('Cancelled')).toBeInTheDocument();
    // A deliberate cancel is not an error: no error text in the list, no failure toast.
    expect(queue.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Couldn.t upload/)).not.toBeInTheDocument();
  });

  it('shows the server’s reason when an upload fails, and keeps going with the next file', async () => {
    central.me.upload
      .mockRejectedValueOnce(new ApiError('The storage is full. Please contact the administrator.', { status: 507, code: 'CENTRAL_STORAGE_QUOTA_EXCEEDED' }))
      .mockResolvedValueOnce(file({ name: 'second.pdf' }));
    renderWithProviders(<MyFilesPage />);
    await screen.findByText('invoice.pdf');

    fireEvent.change(screen.getByLabelText('Choose files to upload'), { target: { files: [new File(['x'], 'first.pdf'), new File(['x'], 'second.pdf')] } });

    expect((await screen.findAllByText(/The storage is full/)).length).toBeGreaterThan(0);
    await waitFor(() => expect(central.me.upload).toHaveBeenCalledTimes(2));
    const queue = within(screen.getByRole('region', { name: 'Uploads' }));
    expect(await queue.findByText('Failed')).toBeInTheDocument();
    expect(await queue.findByText('Uploaded')).toBeInTheDocument();
  });

  it('refreshes the list and usage after an upload', async () => {
    central.me.upload.mockResolvedValue(file({ name: 'new.pdf' }));
    renderWithProviders(<MyFilesPage />);
    await screen.findByText('invoice.pdf');
    const listCalls = central.me.list.mock.calls.length;
    const usageCalls = central.me.usage.mock.calls.length;

    fireEvent.change(screen.getByLabelText('Choose files to upload'), { target: { files: [new File(['x'], 'new.pdf')] } });

    await waitFor(() => expect(central.me.list.mock.calls.length).toBeGreaterThan(listCalls));
    expect(central.me.usage.mock.calls.length).toBeGreaterThan(usageCalls);
  });
});

describe('when central storage is not connected', () => {
  beforeEach(() => stubApi({ available: false }));

  it('explains it, and does not claim anything works', async () => {
    renderWithProviders(<MyFilesPage />);
    expect(await screen.findByText('File storage isn’t available right now')).toBeInTheDocument();
    expect(screen.getByText(/Uploading and opening files is unavailable until an administrator connects the storage/)).toBeInTheDocument();
    // An ordinary user is not offered the administrator's fix.
    expect(screen.queryByRole('link', { name: /storage settings/i })).not.toBeInTheDocument();
  });

  it('disables uploads (the area and the file input), and nothing is sent', async () => {
    renderWithProviders(<MyFilesPage />);
    await screen.findByText('File storage isn’t available right now');

    const area = screen.getByRole('button', { name: /Upload files/ });
    expect(area).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByLabelText('Choose files to upload')).toBeDisabled();
    expect(screen.getByText('Uploads are unavailable until storage is connected.')).toBeInTheDocument();

    fireEvent.drop(area, { dataTransfer: { files: [new File(['x'], 'a.pdf')] } });
    expect(central.me.upload).not.toHaveBeenCalled();
  });

  it('disables opening files (preview and download) but still lists them', async () => {
    renderWithProviders(<MyFilesPage />);
    expect(await screen.findByText('invoice.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download invoice.pdf' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview invoice.pdf' })).toBeDisabled();
  });
});

describe('file actions', () => {
  it('downloads through the API (bytes), never a OneDrive link', async () => {
    central.me.download.mockResolvedValue(new Blob(['%PDF-'], { type: 'application/octet-stream' }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderWithProviders(<MyFilesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Download invoice.pdf' }));

    await waitFor(() => expect(central.me.download).toHaveBeenCalledWith('10'));
    await waitFor(() => expect(click).toHaveBeenCalled());
  });

  it('tells the user when a download fails', async () => {
    central.me.download.mockRejectedValue(new ApiError('File storage is temporarily unavailable.', { status: 503 }));
    renderWithProviders(<MyFilesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Download invoice.pdf' }));
    expect(await screen.findByText('Couldn’t download invoice.pdf')).toBeInTheDocument();
    expect(screen.getByText('File storage is temporarily unavailable.')).toBeInTheDocument();
  });

  it('renames: validates the name, keeps the extension, and sends the change', async () => {
    central.me.rename.mockResolvedValue(file({ name: 'Final.pdf' }));
    renderWithProviders(<MyFilesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for invoice.pdf' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));

    const dialog = await screen.findByRole('dialog', { name: 'Rename file' });
    const input = within(dialog).getByLabelText(/New name/);
    await userEvent.clear(input);
    await userEvent.type(input, 'notes.docx');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    expect(await within(dialog).findByText(/extension cannot be changed/)).toBeInTheDocument();
    expect(central.me.rename).not.toHaveBeenCalled();

    await userEvent.clear(input);
    await userEvent.type(input, 'Final.pdf');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(central.me.rename).toHaveBeenCalledWith('10', 'Final.pdf'));
    expect(await screen.findByText('File renamed')).toBeInTheDocument();
  });

  it('asks before deleting, names the file, and does nothing when cancelled', async () => {
    renderWithProviders(<MyFilesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for invoice.pdf' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete file?' });
    expect(within(dialog).getByText('invoice.pdf')).toBeInTheDocument();
    expect(central.me.remove).not.toHaveBeenCalled(); // nothing happens until it is confirmed

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(central.me.remove).not.toHaveBeenCalled();
  });

  it('deletes after confirmation and reloads the list', async () => {
    central.me.remove.mockResolvedValue(undefined);
    renderWithProviders(<MyFilesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for invoice.pdf' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete file?' });
    const listCalls = central.me.list.mock.calls.length;

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(central.me.remove).toHaveBeenCalledWith('10'));
    expect(await screen.findByText('File deleted')).toBeInTheDocument();
    await waitFor(() => expect(central.me.list.mock.calls.length).toBeGreaterThan(listCalls));
    // Own file: there is no audit-trail wording for the owner.
    expect(screen.queryByText(/audit trail/i)).not.toBeInTheDocument();
  });

  it('keeps the dialog open and shows the reason when a delete fails', async () => {
    central.me.remove.mockRejectedValue(new ApiError('File storage is temporarily unavailable.', { status: 503 }));
    renderWithProviders(<MyFilesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for invoice.pdf' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete file?' });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('File storage is temporarily unavailable.');
    expect(screen.queryByText('File deleted')).not.toBeInTheDocument();
  });

  it('replaces content: only the same file type, with a visible choice and a result', async () => {
    central.me.replaceContent.mockResolvedValue(file({ contentVersion: 2 }));
    renderWithProviders(<MyFilesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for invoice.pdf' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Replace content' }));
    const dialog = await screen.findByRole('dialog', { name: 'Replace file content' });

    fireEvent.change(within(dialog).getByLabelText('Choose a file'), { target: { files: [new File(['x'], 'photo.png')] } });
    expect(await within(dialog).findByText(/Choose a \.pdf file/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Replace content' })).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Choose a file'), { target: { files: [new File(['%PDF-'], 'new-version.pdf')] } });
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Replace content' }));

    await waitFor(() => expect(central.me.replaceContent).toHaveBeenCalledTimes(1));
    expect(central.me.replaceContent.mock.calls[0]?.[0]).toBe('10');
    expect(await screen.findByText('Content replaced')).toBeInTheDocument();
  });

  it('shows details (metadata) of a file, without administrator-only fields', async () => {
    renderWithProviders(<MyFilesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Details of invoice.pdf' }));
    const drawer = await screen.findByRole('dialog', { name: 'File details' });
    expect(within(drawer).getByText('application/pdf')).toBeInTheDocument();
    expect(within(drawer).getByText('2.0 KB')).toBeInTheDocument();
    expect(within(drawer).queryByText('Owner')).not.toBeInTheDocument();
  });
});
