import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-types';
import { file } from '@/test/fixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import { ReplaceFileModal } from './ReplaceFileModal';

vi.mock('@/lib/api');

const replaceContent = vi.mocked(api.centralStorage.me.replaceContent);
const onClose = vi.fn();

async function openAndChoose() {
  renderWithProviders(<ReplaceFileModal scope="me" file={file()} maxFileBytes={50 * 1024 * 1024} audited={false} onClose={onClose} />);
  const dialog = await screen.findByRole('dialog', { name: 'Replace file content' });
  fireEvent.change(within(dialog).getByLabelText('Choose a file'), { target: { files: [new File(['%PDF-'], 'new.pdf')] } });
  return dialog;
}

beforeEach(() => vi.clearAllMocks());

describe('replacing content when the server limits it (429)', () => {
  it('says how long to wait, keeps the dialog open, and lets the user try again', async () => {
    const message = 'You have reached the limit of 10 replacements per 10 minutes. Try again in 5 minutes.';
    replaceContent.mockRejectedValueOnce(new ApiError(message, { status: 429, code: 'UPLOAD_RATE_LIMITED', retryAfterSeconds: 300 }));
    const dialog = await openAndChoose();

    await userEvent.click(await within(dialog).findByRole('button', { name: 'Replace content' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
    expect(onClose).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Replace content' })).toBeEnabled();

    replaceContent.mockResolvedValueOnce(file({ contentVersion: 2 }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replace content' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(replaceContent).toHaveBeenCalledTimes(2);
  });

  it('a busy server is reported the same way, with the wait added when the message names none', async () => {
    replaceContent.mockRejectedValueOnce(new ApiError('Storage is busy.', { status: 429, code: 'CENTRAL_STORAGE_THROTTLED', retryAfterSeconds: 45 }));
    const dialog = await openAndChoose();

    await userEvent.click(await within(dialog).findByRole('button', { name: 'Replace content' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Storage is busy. Try again in 45 seconds.');
  });

  it('other failures keep their own message', async () => {
    replaceContent.mockRejectedValueOnce(new ApiError('File storage is temporarily unavailable.', { status: 503, code: 'CENTRAL_STORAGE_UNAVAILABLE' }));
    const dialog = await openAndChoose();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Replace content' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('File storage is temporarily unavailable.');
  });
});
