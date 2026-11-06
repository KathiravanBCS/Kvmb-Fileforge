import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-types';
import { capabilities, recoveryItem, recoverySummary } from '@/test/fixtures';
import { ADMIN, ALICE, renderWithProviders } from '@/test/renderWithProviders';
import { StorageRecoveryPage } from './StorageRecoveryPage';

vi.mock('@/lib/api');

const recovery = vi.mocked(api.centralStorage.admin.recovery, { deep: true });
const central = vi.mocked(api.centralStorage, { deep: true });

const review = recoveryItem({
  id: '31',
  fileName: 'orphan.pdf',
  status: 'failed',
  state: 'needs_review',
  reviewReason: 'orphan_onedrive_item',
  explanation: 'The upload is recorded as failed, but a file with its generated name still exists in OneDrive. It was NOT deleted.',
});
const retrying = recoveryItem({
  id: '32',
  fileName: 'retry-me.docx',
  extension: 'docx',
  status: 'deleting',
  state: 'retrying',
  attempts: 2,
  nextRecoveryAt: '2026-11-06T09:00:00.000Z',
  owner: { id: '3', displayName: null, email: 'bob@example.com' },
});
const waiting = recoveryItem();
const list = (items = [review, retrying, waiting], total = items.length) => ({ items, page: 1, pageSize: 100, total });

function stubApi({ isSystemAdmin = true }: { isSystemAdmin?: boolean } = {}) {
  vi.mocked(api.workspaces.list).mockResolvedValue([{ id: '1', name: 'Personal', type: 'personal', role: 'owner' }]);
  central.capabilities.mockResolvedValue(capabilities({ isSystemAdmin }));
  recovery.summary.mockResolvedValue(recoverySummary());
  recovery.list.mockResolvedValue(list());
  recovery.detail.mockImplementation((id) =>
    Promise.resolve({
      item: [review, retrying, waiting].find((item) => item.id === id) ?? waiting,
      events: [
        { action: 'central_storage.recovery.needs_review', actorType: 'system', occurredAt: '2026-11-06T08:30:00.000Z', details: {} },
        { action: 'central_storage.recovery.retry_requested', actorType: 'system_admin', occurredAt: '2026-11-06T08:45:00.000Z', details: {} },
      ],
    }),
  );
}

const renderPage = () => renderWithProviders(<StorageRecoveryPage />, { user: ADMIN, route: '/admin/storage/recovery' });

beforeEach(() => stubApi());

describe('access', () => {
  it('is for system administrators only: others see an explanation and no recovery data is requested', async () => {
    stubApi({ isSystemAdmin: false });
    renderWithProviders(<StorageRecoveryPage />, { user: ALICE });

    expect(await screen.findByText('Administrators only')).toBeInTheDocument();
    expect(recovery.summary).not.toHaveBeenCalled();
    expect(recovery.list).not.toHaveBeenCalled();
    expect(recovery.retry).not.toHaveBeenCalled();
  });
});

describe('the dashboard', () => {
  it('shows the counts and the files that need attention, with their owners and states', async () => {
    renderPage();

    expect(await screen.findByText('orphan.pdf')).toBeInTheDocument();
    expect(screen.getByText('retry-me.docx')).toBeInTheDocument();
    expect(screen.getByText('stuck-upload.pdf')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Needs review' })).toHaveTextContent('1');
    expect(screen.getByRole('group', { name: 'Repaired, last 24 h' })).toHaveTextContent('3');
    expect(screen.getByText('bob@example.com')).toBeInTheDocument(); // an owner without a display name
    // The state of each row is shown as a badge (the dashboard tile carries the same words).
    expect(screen.getAllByText('Needs review')).toHaveLength(2);
    expect(screen.getAllByText('Retrying')).toHaveLength(2);
    expect(screen.getAllByText('Waiting')).toHaveLength(2);
    expect(screen.getByText('2 of 6')).toBeInTheDocument();
    expect(recovery.list).toHaveBeenCalledWith('all', expect.anything());
  });

  it('never shows OneDrive identifiers, stored names or tokens', async () => {
    renderPage();
    await screen.findByText('orphan.pdf');
    expect(document.body.textContent).not.toMatch(/eTag|checksum|item[-_ ]?id|stored[-_ ]?name/i);
  });

  it('filters by queue through the API', async () => {
    renderPage();
    await screen.findByText('orphan.pdf');

    recovery.list.mockResolvedValue(list([review]));
    await userEvent.click(screen.getByRole('radio', { name: /Needs review \(1\)/ }));

    await waitFor(() => expect(recovery.list).toHaveBeenLastCalledWith('needs_review', expect.anything()));
    await waitFor(() => expect(screen.queryByText('retry-me.docx')).not.toBeInTheDocument());
    expect(screen.getByText('orphan.pdf')).toBeInTheDocument();
  });

  it('says so when nothing needs attention', async () => {
    recovery.summary.mockResolvedValue(recoverySummary({ needsReview: 0, retrying: 0, waiting: 0 }));
    recovery.list.mockResolvedValue(list([]));
    renderPage();
    expect(await screen.findByText('Nothing needs attention')).toBeInTheDocument();
  });

  it('explains that automatic recovery is off, and that retrying by hand still works', async () => {
    recovery.summary.mockResolvedValue(recoverySummary({ worker: { enabled: false, intervalSeconds: 60, staleMinutes: 30, maxAttempts: 6 } }));
    renderPage();
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('Automatic recovery is off');
    expect(note).toHaveTextContent('Retry now');
  });

  it('does not claim automatic recovery is off while that is still unknown', async () => {
    recovery.summary.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await screen.findByText('orphan.pdf');
    expect(screen.queryByText('Automatic recovery is off')).not.toBeInTheDocument();
  });

  it('points to Storage Settings when OneDrive must be reconnected', async () => {
    recovery.summary.mockResolvedValue(recoverySummary({ reauthRequired: 2 }));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('2 files are waiting for the central OneDrive');
    expect(within(alert).getByRole('link', { name: 'Open Storage Settings' })).toHaveAttribute('href', '/admin/storage/settings');
  });

  it('says when only the first part of a long queue is shown', async () => {
    recovery.list.mockResolvedValue(list([review], 250));
    renderPage();
    expect(await screen.findByText(/Showing the first 1 of 250/)).toBeInTheDocument();
  });

  it('reports a summary failure without inventing numbers, and a list failure with a retry', async () => {
    recovery.summary.mockRejectedValue(new ApiError('The server is down.', { status: 503 }));
    recovery.list.mockRejectedValueOnce(new ApiError('The list is down.', { status: 503 })).mockResolvedValue(list());
    renderPage();

    expect(await screen.findByText('The server is down.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Needs review' })).toHaveTextContent('—');
    expect(await screen.findByText('The list is down.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('orphan.pdf')).toBeInTheDocument();
  });
});

describe('one file', () => {
  const open = async (name: string) => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: `Details of ${name}` }));
    return screen.findByRole('dialog', { name: 'Recovery details' });
  };

  it('shows what happened, what is planned, and the history', async () => {
    const drawer = await open('orphan.pdf');
    expect(await within(drawer).findByRole('note')).toHaveTextContent('It was NOT deleted');
    expect(within(drawer).getByText('alice@example.com')).toBeInTheDocument();
    const history = within(drawer).getByRole('list', { name: 'Recovery history' });
    expect(within(history).getByText('Handed to an administrator')).toBeInTheDocument();
    expect(within(history).getByText('Automatic recovery')).toBeInTheDocument();
    expect(within(history).getByText('Retry requested')).toBeInTheDocument();
    expect(within(history).getByText('An administrator')).toBeInTheDocument();
    expect(recovery.detail).toHaveBeenCalledWith('31', expect.anything());
  });

  it('Retry now asks first, then runs the recovery and reports the result', async () => {
    recovery.retry.mockResolvedValue({ outcome: 'repaired', item: { ...waiting, status: 'ready' } });
    const drawer = await open('stuck-upload.pdf');

    await userEvent.click(await within(drawer).findByRole('button', { name: 'Retry now' }));
    const confirm = await screen.findByRole('dialog', { name: 'Retry recovery now?' });
    expect(recovery.retry).not.toHaveBeenCalled(); // nothing happens until it is confirmed
    expect(confirm).toHaveTextContent('Nothing is deleted from OneDrive except finishing a delete that was already requested');

    await userEvent.click(within(confirm).getByRole('button', { name: 'Retry now' }));

    await waitFor(() => expect(recovery.retry).toHaveBeenCalledWith('30'));
    expect(await screen.findByText('Recovered')).toBeInTheDocument();
    expect(recovery.retry).toHaveBeenCalledTimes(1);
  });

  it('cancelling the confirmation does nothing', async () => {
    const drawer = await open('stuck-upload.pdf');
    await userEvent.click(await within(drawer).findByRole('button', { name: 'Retry now' }));
    const confirm = await screen.findByRole('dialog', { name: 'Retry recovery now?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Retry recovery now?' })).not.toBeInTheDocument());
    expect(recovery.retry).not.toHaveBeenCalled();
  });

  it('says honestly when the retry could not finish the job', async () => {
    recovery.retry.mockResolvedValue({ outcome: 'needs_review', item: review });
    const drawer = await open('stuck-upload.pdf');
    await userEvent.click(await within(drawer).findByRole('button', { name: 'Retry now' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Retry recovery now?' })).getByRole('button', { name: 'Retry now' }));

    expect(await screen.findByText('Needs your review')).toBeInTheDocument();
    expect(screen.queryByText('Recovered')).not.toBeInTheDocument();
  });

  it('shows the server’s reason when a worker holds the file', async () => {
    recovery.retry.mockRejectedValue(new ApiError('This file is being worked on right now. Try again in a moment.', { status: 409, code: 'RECOVERY_BUSY' }));
    const drawer = await open('stuck-upload.pdf');
    await userEvent.click(await within(drawer).findByRole('button', { name: 'Retry now' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Retry recovery now?' })).getByRole('button', { name: 'Retry now' }));

    expect(await within(drawer).findByText(/being worked on right now/)).toBeInTheDocument();
    expect(screen.queryByText('Recovered')).not.toBeInTheDocument();
  });

  it('"Mark as reviewed" is offered only for a file waiting for review, and says it changes nothing in OneDrive', async () => {
    recovery.dismiss.mockResolvedValue({ outcome: 'no_action', item: { ...review, state: 'waiting' } });
    const drawer = await open('orphan.pdf');

    await userEvent.click(await within(drawer).findByRole('button', { name: 'Mark as reviewed' }));
    const confirm = await screen.findByRole('dialog', { name: 'Mark as reviewed?' });
    expect(confirm).toHaveTextContent('Nothing is changed in OneDrive');
    expect(recovery.dismiss).not.toHaveBeenCalled();

    await userEvent.click(within(confirm).getByRole('button', { name: 'Mark as reviewed' }));
    await waitFor(() => expect(recovery.dismiss).toHaveBeenCalledWith('31'));
    expect(await screen.findByText('Marked as reviewed')).toBeInTheDocument();
  });

  it('does not offer "Mark as reviewed" for a file that is not waiting for review', async () => {
    const drawer = await open('retry-me.docx');
    await within(drawer).findByRole('button', { name: 'Retry now' });
    expect(within(drawer).queryByRole('button', { name: 'Mark as reviewed' })).not.toBeInTheDocument();
  });

  it('disables both actions while a worker is on the file', async () => {
    recovery.detail.mockResolvedValue({ item: { ...waiting, inProgress: true }, events: [] });
    const drawer = await open('stuck-upload.pdf');
    expect(await within(drawer).findByRole('button', { name: 'Retry now' })).toBeDisabled();
    expect(within(drawer).getByText('A worker is on this file right now.')).toBeInTheDocument();
    expect(within(drawer).getByText('Nothing has been recorded for this file yet.')).toBeInTheDocument();
  });

  it('refreshes the lists and counts after an action', async () => {
    recovery.retry.mockResolvedValue({ outcome: 'repaired', item: waiting });
    const drawer = await open('stuck-upload.pdf');
    const before = recovery.list.mock.calls.length;
    await userEvent.click(await within(drawer).findByRole('button', { name: 'Retry now' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Retry recovery now?' })).getByRole('button', { name: 'Retry now' }));
    await waitFor(() => expect(recovery.list.mock.calls.length).toBeGreaterThan(before));
    expect(recovery.summary.mock.calls.length).toBeGreaterThan(1);
  });
});
