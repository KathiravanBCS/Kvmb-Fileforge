import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-types';
import { capabilities, connection, notConnected } from '@/test/fixtures';
import { ADMIN, ALICE, renderWithProviders } from '@/test/renderWithProviders';
import { CentralStorageSettingsPage } from './CentralStorageSettingsPage';

vi.mock('@/lib/api');

const central = vi.mocked(api.centralStorage, { deep: true });
const MICROSOFT_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=abc';
const assign = vi.fn();

function stubApi({ isSystemAdmin = true }: { isSystemAdmin?: boolean } = {}) {
  vi.mocked(api.workspaces.list).mockResolvedValue([{ id: '1', name: 'Personal', type: 'personal', role: 'owner' }]);
  central.capabilities.mockResolvedValue(capabilities({ isSystemAdmin }));
  central.admin.connection.get.mockResolvedValue(notConnected());
}

const renderSettings = (route = '/admin/storage/settings') => renderWithProviders(<CentralStorageSettingsPage />, { user: ADMIN, route });

beforeEach(() => {
  stubApi();
  assign.mockReset();
  vi.stubGlobal('location', { ...window.location, assign });
});
afterEach(() => vi.unstubAllGlobals());

describe('access', () => {
  it('is for system administrators only: others see an explanation and nothing is requested', async () => {
    stubApi({ isSystemAdmin: false });
    renderWithProviders(<CentralStorageSettingsPage />, { user: ALICE });

    expect(await screen.findByText('Administrators only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect/i })).not.toBeInTheDocument();
    expect(central.admin.connection.get).not.toHaveBeenCalled();
    expect(central.admin.connection.connect).not.toHaveBeenCalled();
  });
});

describe('before the administrator connects OneDrive', () => {
  it('says it is not connected and offers Connect OneDrive', async () => {
    renderSettings();
    expect(await screen.findByLabelText('Connection status: Not connected')).toBeInTheDocument();
    expect(screen.getByText(/Connect the administrator’s OneDrive before anyone can upload files/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect OneDrive' })).toBeInTheDocument();
    // Nothing that implies it works.
    expect(screen.queryByRole('button', { name: 'Check connection' })).not.toBeInTheDocument();
    expect(screen.queryByText('Connected', { exact: true })).not.toBeInTheDocument();
  });

  it('starts the Microsoft flow through the API and sends the browser to Microsoft (no token in the page)', async () => {
    central.admin.connection.connect.mockResolvedValue(MICROSOFT_URL);
    renderSettings();
    await userEvent.click(await screen.findByRole('button', { name: 'Connect OneDrive' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(MICROSOFT_URL));
    expect(central.admin.connection.connect).toHaveBeenCalledTimes(1);
  });

  it('shows why connecting could not start, and does not navigate', async () => {
    central.admin.connection.connect.mockRejectedValue(new ApiError('Your Microsoft session has to be renewed. Please sign in again.', { status: 401, code: 'MICROSOFT_REAUTH_REQUIRED' }));
    renderSettings();
    await userEvent.click(await screen.findByRole('button', { name: 'Connect OneDrive' }));

    expect(await screen.findByText('Couldn’t start the connection')).toBeInTheDocument();
    expect(screen.getByText(/Your Microsoft session has to be renewed/)).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('explains what connecting does, including who can still see the files in OneDrive', async () => {
    renderSettings();
    expect(await screen.findByText('What connecting does')).toBeInTheDocument();
    expect(screen.getByText(/whoever owns this OneDrive account can open the folder in OneDrive directly/)).toBeInTheDocument();
  });
});

describe('a connected OneDrive', () => {
  beforeEach(() => {
    central.admin.connection.get.mockResolvedValue(
      connection({ quota: { total: 5 * 1024 ** 3, used: 1024 ** 3, remaining: 4 * 1024 ** 3, state: 'normal' } }),
    );
  });

  it('shows the connected Microsoft account, folder, times and storage figures', async () => {
    renderSettings();
    expect(await screen.findByLabelText('Connection status: Connected')).toBeInTheDocument();
    expect(screen.getByText('Admin (admin@example.com)')).toBeInTheDocument();
    expect(screen.getByText('Personal Microsoft account')).toBeInTheDocument();
    expect(screen.getByText('FileForge-Central')).toBeInTheDocument();
    expect(screen.getByText(/1\.0 GB of 5\.0 GB used · 4\.0 GB free/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'OneDrive storage used' })).toHaveAttribute('aria-valuenow', '20');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('never shows anything secret (tokens, ciphertext, OneDrive ids)', async () => {
    renderSettings();
    await screen.findByLabelText('Connection status: Connected');
    const text = document.body.textContent ?? '';
    for (const forbidden of [/token/i, /cipher/i, /nonce/i, /refresh/i, /secret/i, /drive-id/i]) {
      expect(text).not.toMatch(forbidden);
    }
  });

  it('checks the connection on request and says it works only when the API says so', async () => {
    central.admin.connection.verify.mockResolvedValue(connection({ lastVerifiedAt: '2026-11-05T12:00:00.000Z' }));
    renderSettings();
    await userEvent.click(await screen.findByRole('button', { name: 'Check connection' }));

    expect(await screen.findByText('Connection works')).toBeInTheDocument();
    expect(central.admin.connection.verify).toHaveBeenCalledTimes(1);
  });

  it('does NOT claim success when the check finds the connection broken', async () => {
    central.admin.connection.verify.mockResolvedValue(connection({ status: 'reauth_required', usable: false, lastErrorCode: 'reauth_required' }));
    renderSettings();
    await userEvent.click(await screen.findByRole('button', { name: 'Check connection' }));

    expect(await screen.findByText('The connection is not working')).toBeInTheDocument();
    expect(screen.queryByText('Connection works')).not.toBeInTheDocument();
    expect(await screen.findByLabelText('Connection status: Reconnect required')).toBeInTheDocument();
  });

  it('shows a failed check as an error, not a success', async () => {
    central.admin.connection.verify.mockRejectedValue(new ApiError('File storage is temporarily unavailable.', { status: 503 }));
    renderSettings();
    await userEvent.click(await screen.findByRole('button', { name: 'Check connection' }));
    expect(await screen.findByText('The connection check failed')).toBeInTheDocument();
    expect(screen.queryByText('Connection works')).not.toBeInTheDocument();
  });

  it('lets the administrator reconnect', async () => {
    central.admin.connection.connect.mockResolvedValue(MICROSOFT_URL);
    renderSettings();
    await userEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(MICROSOFT_URL));
  });
});

describe('an expired or revoked authorization', () => {
  it.each([
    ['reauth_required', 'Reconnect required'],
    ['revoked', 'Access revoked'],
    ['error', 'Needs attention'],
  ] as const)('%s: shows a clear state and makes Reconnect the main action', async (status, label) => {
    central.admin.connection.get.mockResolvedValue(connection({ status, usable: false, lastErrorCode: status }));
    renderSettings();

    expect(await screen.findByLabelText(`Connection status: ${label}`)).toBeInTheDocument();
    expect(screen.getByText('Uploads and downloads are unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect OneDrive' })).toBeInTheDocument();
    expect(screen.getByText(status, { exact: true })).toBeInTheDocument(); // "Last problem"
    expect(screen.queryByText('Connection works')).not.toBeInTheDocument();
  });
});

describe('coming back from Microsoft', () => {
  it('shows success, honestly worded (it still has to be checked), and can be dismissed', async () => {
    central.admin.connection.get.mockResolvedValue(connection());
    renderSettings('/admin/storage/settings?central=connected');

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('Central OneDrive connected');
    expect(notice).toHaveTextContent('Check connection');
    await userEvent.click(within(notice).getByRole('button', { name: 'Dismiss notice' }));
    await waitFor(() => expect(screen.queryByText(/Central OneDrive connected/)).not.toBeInTheDocument());
  });

  it.each([
    ['account_mismatch', /not the Microsoft account you are signed in with/],
    ['access_denied', /cancelled, so nothing was changed/],
    ['consent_required', /did not grant the permission/],
    ['central_storage_forbidden', /Only system administrators/],
    ['central_storage_unavailable', /could not be set up right now/],
    ['something_unknown', /did not complete/],
  ])('%s shows a specific error', async (code, message) => {
    renderSettings(`/admin/storage/settings?central_error=${code}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });
});

describe('loading and errors', () => {
  it('shows a retry when the status cannot be loaded, and no made-up status', async () => {
    central.admin.connection.get.mockRejectedValueOnce(new ApiError('File storage is temporarily unavailable.', { status: 503 }));
    renderSettings();
    expect(await screen.findByText('We couldn’t load the connection status')).toBeInTheDocument();
    expect(screen.queryByText(/Connection status/)).not.toBeInTheDocument();

    central.admin.connection.get.mockResolvedValue(connection());
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Connection status: Connected')).toBeInTheDocument();
  });
});
