import type { ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { AuthContext } from '@/features/auth/AuthContext';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-types';
import { file } from '@/test/fixtures';
import { ALICE, createTestQueryClient } from '@/test/renderWithProviders';
import { useUploadCentralFiles } from './useUploadCentralFiles';

vi.mock('@/lib/api');

const upload = vi.mocked(api.centralStorage.me.upload);
const adminUpload = vi.mocked(api.centralStorage.admin.upload);
const MB = 1024 * 1024;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <MantineProvider env="test">
        <AuthContext.Provider value={{ status: 'authenticated', user: ALICE, login: () => undefined, logout: () => Promise.resolve(), refetch: () => undefined }}>
          {children}
        </AuthContext.Provider>
      </MantineProvider>
    </QueryClientProvider>
  );
}

const names = (items: { name: string; status: string }[]) => items.map((item) => `${item.name}:${item.status}`);
const limited = (code: string, retryAfterSeconds?: number, message = 'Please wait.') =>
  new ApiError(message, { status: 429, code, retryAfterSeconds });
const render = () => renderHook(() => useUploadCentralFiles({ scope: 'me', maxFileBytes: 50 * MB }), { wrapper });
const redToasts = (spy: MockInstance<typeof notifications.show>) =>
  spy.mock.calls.filter(([options]) => options.color === 'red');

let toast: MockInstance<typeof notifications.show>;

beforeEach(() => {
  upload.mockResolvedValue(file());
  adminUpload.mockResolvedValue(file());
  toast = vi.spyOn(notifications, 'show').mockReturnValue('id');
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  toast.mockRestore();
});

describe('when the server limits uploads (429)', () => {
  it('stops the batch when the allowance is used up: the rest is not sent, and one clear message is shown', async () => {
    const message = 'You have reached the limit of 10 uploads per 10 minutes. Try again in 5 minutes.';
    upload.mockResolvedValueOnce(file()).mockRejectedValueOnce(limited('UPLOAD_RATE_LIMITED', 300, message));
    const { result } = render();

    act(() => result.current.add(['a', 'b', 'c', 'd'].map((name) => new File(['x'], `${name}.pdf`))));

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(names(result.current.items)).toEqual(['a.pdf:done', 'b.pdf:failed', 'c.pdf:failed', 'd.pdf:failed']);
    expect(upload).toHaveBeenCalledTimes(2); // c and d never left the browser
    expect(result.current.items[1]?.error).toBe(message);
    expect(result.current.items[2]?.error).toBe(`Not uploaded. ${message}`);
    const limitToasts = toast.mock.calls.filter(([options]) => options.title === 'Upload limit reached');
    expect(limitToasts).toHaveLength(1);
    expect(limitToasts[0]?.[0]).toMatchObject({ color: 'yellow', message, autoClose: false });
    expect(redToasts(toast)).toHaveLength(0); // hitting a limit is not shown as an error
  });

  it('a later batch is tried again (the limit belongs to the server, it is not remembered here)', async () => {
    upload.mockRejectedValueOnce(limited('UPLOAD_RATE_LIMITED', 5)).mockResolvedValue(file());
    const { result } = render();
    act(() => result.current.add([new File(['x'], 'a.pdf')]));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('failed'));

    act(() => result.current.add([new File(['x'], 'b.pdf')]));
    await waitFor(() => expect(result.current.items[1]?.status).toBe('done'));
  });

  it('waits for the time the server named, then tries the same file again', async () => {
    upload.mockRejectedValueOnce(limited('UPLOAD_TOO_MANY_ACTIVE', 10)).mockResolvedValue(file());
    const { result } = render();

    act(() => result.current.add([new File(['x'], 'a.pdf')]));

    await waitFor(() => expect(result.current.items[0]?.notice).toBe('Storage is busy. Trying again in 10 seconds…'));
    expect(result.current.items[0]?.status).toBe('queued');
    expect(upload).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(9_000));
    expect(upload).toHaveBeenCalledTimes(1); // not yet

    await act(() => vi.advanceTimersByTimeAsync(1_500));
    await waitFor(() => expect(result.current.items[0]).toMatchObject({ status: 'done', notice: undefined }));
    expect(upload).toHaveBeenCalledTimes(2);
    expect(redToasts(toast)).toHaveLength(0);
  });

  it('never waits longer than 30 seconds, and uses 10 when the server named no time', async () => {
    upload
      .mockRejectedValueOnce(limited('UPLOAD_CAPACITY_BUSY', 600))
      .mockRejectedValueOnce(limited('CENTRAL_STORAGE_THROTTLED'))
      .mockResolvedValue(file());
    const { result } = render();
    act(() => result.current.add([new File(['x'], 'a.pdf')]));

    await waitFor(() => expect(result.current.items[0]?.notice).toBe('Storage is busy. Trying again in 30 seconds…'));
    await act(() => vi.advanceTimersByTimeAsync(30_500));
    await waitFor(() => expect(result.current.items[0]?.notice).toBe('Storage is busy. Trying again in 10 seconds…'));
    await act(() => vi.advanceTimersByTimeAsync(10_500));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('done'));
    expect(upload).toHaveBeenCalledTimes(3);
  });

  it('gives up after two retries and shows the server message as an error, then goes on with the next file', async () => {
    upload.mockRejectedValue(limited('UPLOAD_CAPACITY_BUSY', 1, 'The storage is busy. Please try again shortly.'));
    const { result } = render();
    act(() => result.current.add([new File(['x'], 'a.pdf'), new File(['x'], 'b.pdf')]));

    await act(() => vi.advanceTimersByTimeAsync(2_500));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('failed'));
    expect(upload.mock.calls.filter(([picked]) => picked.name === 'a.pdf')).toHaveLength(3); // the first try + 2 retries
    expect(result.current.items[0]?.error).toBe('The storage is busy. Please try again shortly.');
    expect(redToasts(toast).length).toBeGreaterThan(0);

    await act(() => vi.advanceTimersByTimeAsync(2_500));
    await waitFor(() => expect(result.current.items[1]?.status).toBe('failed'));
  });

  it('Cancel during the wait stops it at once and sends nothing more', async () => {
    upload.mockRejectedValueOnce(limited('UPLOAD_TOO_MANY_ACTIVE', 20)).mockResolvedValue(file());
    const { result } = render();
    act(() => result.current.add([new File(['x'], 'a.pdf')]));
    await waitFor(() => expect(result.current.items[0]?.notice).toBeDefined());

    act(() => result.current.cancel(result.current.items[0]?.id ?? ''));

    await waitFor(() => expect(result.current.items[0]).toMatchObject({ status: 'cancelled', notice: undefined }));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
  });

  it('other errors are never retried automatically', async () => {
    upload.mockRejectedValue(new ApiError('File storage is temporarily unavailable.', { status: 503, code: 'CENTRAL_STORAGE_UNAVAILABLE' }));
    const { result } = render();
    act(() => result.current.add([new File(['x'], 'a.pdf')]));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('failed'));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('administrator uploads are limited and retried the same way', async () => {
    adminUpload.mockRejectedValueOnce(limited('UPLOAD_TOO_MANY_ACTIVE', 2)).mockResolvedValue(file());
    const { result } = renderHook(() => useUploadCentralFiles({ scope: 'admin', targetUserId: '3', maxFileBytes: 50 * MB }), { wrapper });
    act(() => result.current.add([new File(['x'], 'a.pdf')]));
    await waitFor(() => expect(result.current.items[0]?.notice).toBeDefined());
    await act(() => vi.advanceTimersByTimeAsync(2_500));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('done'));
    expect(adminUpload).toHaveBeenCalledTimes(2);
  });
});
