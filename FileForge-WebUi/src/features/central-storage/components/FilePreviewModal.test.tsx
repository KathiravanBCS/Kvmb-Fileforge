import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-types';
import { file } from '@/test/fixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import { FilePreviewModal } from './FilePreviewModal';

vi.mock('@/lib/api');

const preview = vi.mocked(api.centralStorage.me.preview);
const adminPreview = vi.mocked(api.centralStorage.admin.preview);
const onDownload = vi.fn();
const onClose = vi.fn();

const open = (target = file({ previewable: true }), scope: 'me' | 'admin' = 'me') =>
  renderWithProviders(<FilePreviewModal scope={scope} file={target} onClose={onClose} onDownload={onDownload} />);

const created = vi.fn();
const revoked = vi.fn();
beforeEach(() => {
  created.mockReset().mockImplementation(() => `blob:preview-${created.mock.calls.length}`);
  revoked.mockReset();
  URL.createObjectURL = created;
  URL.revokeObjectURL = revoked;
});

describe('what the preview will show', () => {
  it('shows an image', async () => {
    preview.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    open(file({ id: '1', name: 'photo.png', extension: 'png', mimeType: 'image/png', previewable: true }));
    const image = await screen.findByAltText('photo.png');
    expect(image).toHaveAttribute('src', expect.stringMatching(/^blob:preview-/));
  });

  it('shows a PDF in a frame', async () => {
    preview.mockResolvedValue(new Blob(['%PDF-'], { type: 'application/pdf' }));
    open();
    const frame = await screen.findByTitle('PDF preview of invoice.pdf');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', expect.stringMatching(/^blob:preview-/));
  });

  it('shows plain text AS TEXT: markup in the file is never interpreted', async () => {
    preview.mockResolvedValue(new Blob(['<script>window.hacked=true</script><b>bold</b> hello'], { type: 'text/plain; charset=utf-8' }));
    const { container } = open(file({ id: '2', name: 'notes.txt', extension: 'txt', mimeType: 'text/plain', previewable: true }));

    expect(await screen.findByText(/<script>window\.hacked=true<\/script><b>bold<\/b> hello/)).toBeInTheDocument();
    expect(document.querySelector('script:not([src])')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
    expect(container.ownerDocument.defaultView && (window as unknown as { hacked?: boolean }).hacked).toBeFalsy();
  });

  it('shortens a very long text file instead of freezing the page', async () => {
    preview.mockResolvedValue(new Blob(['a'.repeat(250_000)], { type: 'text/plain' }));
    open(file({ id: '3', name: 'big.txt', extension: 'txt', mimeType: 'text/plain', previewable: true }));
    expect(await screen.findByText(/preview shortened/)).toBeInTheDocument();
  });
});

describe('what the preview refuses', () => {
  it.each([
    ['HTML', 'text/html'],
    ['SVG', 'image/svg+xml'],
    ['JavaScript', 'application/javascript'],
    ['an unknown type', 'application/octet-stream'],
    ['XML', 'application/xml'],
  ])('never renders %s, even if the file was marked previewable: it offers the download instead', async (_label, type) => {
    preview.mockResolvedValue(new Blob(['<script>alert(1)</script>'], { type }));
    open();

    expect(await screen.findByText(/can’t be shown safely in the browser/)).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(created).not.toHaveBeenCalled(); // not even a blob address was made for it
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('does not even request the content of a file that cannot be previewed', async () => {
    open(file({ id: '4', name: 'sheet.xlsx', extension: 'xlsx', mimeType: 'application/vnd.ms-excel', previewable: false }));
    expect(await screen.findByText(/This file type can’t be previewed/)).toBeInTheDocument();
    expect(preview).not.toHaveBeenCalled();
    expect(adminPreview).not.toHaveBeenCalled();
  });

  it('uses the right API for the scope: the own-files API for a user, the administrator API for an administrator', async () => {
    preview.mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
    adminPreview.mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
    open(file({ id: '5', previewable: true }), 'admin');
    await waitFor(() => expect(adminPreview).toHaveBeenCalledWith('5', expect.anything()));
    expect(preview).not.toHaveBeenCalled();
  });
});

describe('loading, failure and cleanup', () => {
  it('shows a loading state, then retries after a failure', async () => {
    preview.mockRejectedValueOnce(new ApiError('File storage is temporarily unavailable.', { status: 503 }));
    open();
    expect(await screen.findByText('The preview couldn’t be loaded')).toBeInTheDocument();
    expect(screen.getByText('File storage is temporarily unavailable.')).toBeInTheDocument();

    preview.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByAltText('invoice.pdf')).toBeInTheDocument();
  });

  it('releases the temporary address when the preview closes (nothing lingers in memory)', async () => {
    preview.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    const { rerender } = open(file({ id: '6', name: 'photo.png', extension: 'png', previewable: true }));
    await screen.findByAltText('photo.png');
    const url = created.mock.results.at(-1)?.value as string;

    rerender(<FilePreviewModal scope="me" file={null} onClose={onClose} onDownload={onDownload} />);

    await waitFor(() => expect(revoked).toHaveBeenCalledWith(url));
  });

  it('does not keep file content in the query cache', async () => {
    preview.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    const { client, rerender } = open(file({ id: '7', name: 'photo.png', extension: 'png', previewable: true }));
    await screen.findByAltText('photo.png');
    rerender(<FilePreviewModal scope="me" file={null} onClose={onClose} onDownload={onDownload} />);
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ['central-storage', '2', 'me', 'preview'] })).toHaveLength(0));
  });
});
