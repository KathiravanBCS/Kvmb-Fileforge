import type { ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const sized = (name: string, size: number) => {
  const picked = new File(['x'], name);
  Object.defineProperty(picked, 'size', { value: size });
  return picked;
};
const names = (items: { name: string; status: string }[]) => items.map((item) => `${item.name}:${item.status}`);

beforeEach(() => {
  upload.mockResolvedValue(file());
  adminUpload.mockResolvedValue(file());
});

describe('the upload queue', () => {
  it('uploads files one at a time, in order', async () => {
    const order: string[] = [];
    let releaseFirst: () => void = () => undefined;
    upload.mockImplementation((picked) => {
      order.push(`start ${picked.name}`);
      return new Promise((resolve) => {
        const done = () => {
          order.push(`end ${picked.name}`);
          resolve(file());
        };
        if (picked.name === 'a.pdf') releaseFirst = done;
        else done();
      });
    });
    const { result } = renderHook(() => useUploadCentralFiles({ scope: 'me', maxFileBytes: 50 * MB }), { wrapper });

    act(() => result.current.add([new File(['x'], 'a.pdf'), new File(['x'], 'b.pdf')]));
    await waitFor(() => expect(order).toEqual(['start a.pdf']));
    expect(names(result.current.items)).toEqual(['a.pdf:uploading', 'b.pdf:queued']);
    expect(result.current.busy).toBe(true);

    act(() => releaseFirst());
    await waitFor(() => expect(order).toEqual(['start a.pdf', 'end a.pdf', 'start b.pdf', 'end b.pdf']));
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(names(result.current.items)).toEqual(['a.pdf:done', 'b.pdf:done']);
  });

  it('rejects invalid files before any request and still uploads the valid ones', async () => {
    const { result } = renderHook(() => useUploadCentralFiles({ scope: 'me', maxFileBytes: 50 * MB }), { wrapper });

    act(() => result.current.add([sized('huge.pdf', 51 * MB), sized('setup.exe', 10), new File(['x'], 'good.pdf')]));

    await waitFor(() => expect(names(result.current.items)).toEqual(['huge.pdf:failed', 'setup.exe:failed', 'good.pdf:done']));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]?.[0].name).toBe('good.pdf');
    expect(result.current.items[0]?.error).toMatch(/Too large/);
    expect(result.current.items[1]?.error).toMatch(/cannot be stored here/);
  });

  it('honours the limit the API reported (not a hard-coded one)', async () => {
    const { result } = renderHook(() => useUploadCentralFiles({ scope: 'me', maxFileBytes: 1 * MB }), { wrapper });
    act(() => result.current.add([sized('two-mb.pdf', 2 * MB)]));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('failed'));
    expect(result.current.items[0]?.error).toMatch(/files up to 1\.0 MB/);
    expect(upload).not.toHaveBeenCalled();
  });

  it('reports progress as the bytes are sent', async () => {
    let report: (fraction: number) => void = () => undefined;
    let finish: () => void = () => undefined;
    upload.mockImplementation((_picked, options) => {
      report = options?.onProgress ?? (() => undefined);
      return new Promise((resolve) => (finish = () => resolve(file())));
    });
    const { result } = renderHook(() => useUploadCentralFiles({ scope: 'me', maxFileBytes: 50 * MB }), { wrapper });

    act(() => result.current.add([new File(['x'], 'a.pdf')]));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('uploading'));
    act(() => report(0.4));
    expect(result.current.items[0]?.progress).toBe(0.4);
    act(() => report(1));
    expect(result.current.items[0]).toMatchObject({ status: 'uploading', progress: 1 }); // sent, but not "done" until the server answers

    act(() => finish());
    await waitFor(() => expect(result.current.items[0]?.status).toBe('done'));
  });

  it('cancels a running upload by aborting its request, and goes on with the next file', async () => {
    const signals: AbortSignal[] = [];
    upload.mockImplementation((picked, options) => {
      if (picked.name === 'a.pdf') {
        signals.push(options?.signal as AbortSignal);
        return new Promise((_resolve, reject) =>
          options?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('canceled'), { name: 'CanceledError' }))),
        );
      }
      return Promise.resolve(file());
    });
    const { result } = renderHook(() => useUploadCentralFiles({ scope: 'me', maxFileBytes: 50 * MB }), { wrapper });
    act(() => result.current.add([new File(['x'], 'a.pdf'), new File(['x'], 'b.pdf')]));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('uploading'));

    act(() => result.current.cancel(result.current.items[0]?.id ?? ''));

    await waitFor(() => expect(names(result.current.items)).toEqual(['a.pdf:cancelled', 'b.pdf:done']));
    expect(signals[0]?.aborted).toBe(true);
    expect(result.current.items[0]?.error).toBeUndefined(); // a cancel is not an error
  });

  it('cancels a file that is still waiting without ever sending it', async () => {
    let releaseFirst: () => void = () => undefined;
    upload.mockImplementation((picked) => (picked.name === 'a.pdf' ? new Promise((resolve) => (releaseFirst = () => resolve(file()))) : Promise.resolve(file())));
    const { result } = renderHook(() => useUploadCentralFiles({ scope: 'me', maxFileBytes: 50 * MB }), { wrapper });
    act(() => result.current.add([new File(['x'], 'a.pdf'), new File(['x'], 'b.pdf')]));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('uploading'));

    act(() => result.current.cancel(result.current.items[1]?.id ?? ''));
    act(() => releaseFirst());

    await waitFor(() => expect(names(result.current.items)).toEqual(['a.pdf:done', 'b.pdf:cancelled']));
    expect(upload.mock.calls.map((call) => call[0].name)).toEqual(['a.pdf']);
  });

  it('shows the server’s reason for a failure and keeps going', async () => {
    upload
      .mockRejectedValueOnce(new ApiError('This file does not look like a real .pdf file.', { status: 400, code: 'FILE_CONTENT_MISMATCH' }))
      .mockResolvedValueOnce(file());
    const { result } = renderHook(() => useUploadCentralFiles({ scope: 'me', maxFileBytes: 50 * MB }), { wrapper });

    act(() => result.current.add([new File(['x'], 'fake.pdf'), new File(['x'], 'real.pdf')]));

    await waitFor(() => expect(names(result.current.items)).toEqual(['fake.pdf:failed', 'real.pdf:done']));
    expect(result.current.items[0]?.error).toBe('This file does not look like a real .pdf file.');
  });

  it('clears finished items but keeps the active ones', async () => {
    let release: () => void = () => undefined;
    upload.mockImplementation((picked) => (picked.name === 'slow.pdf' ? new Promise((resolve) => (release = () => resolve(file()))) : Promise.resolve(file())));
    const { result } = renderHook(() => useUploadCentralFiles({ scope: 'me', maxFileBytes: 50 * MB }), { wrapper });
    act(() => result.current.add([new File(['x'], 'fast.pdf')]));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('done'));
    act(() => result.current.add([new File(['x'], 'slow.pdf')]));
    await waitFor(() => expect(result.current.items[1]?.status).toBe('uploading'));

    act(() => result.current.clearFinished());

    expect(names(result.current.items)).toEqual(['slow.pdf:uploading']);
    act(() => release());
    await waitFor(() => expect(result.current.busy).toBe(false));
  });
});

describe('who the files go to', () => {
  it('"My Files" uploads never carry a target user, even if one is passed', async () => {
    const { result } = renderHook(() => useUploadCentralFiles({ scope: 'me', targetUserId: '3', maxFileBytes: 50 * MB }), { wrapper });
    act(() => result.current.add([new File(['x'], 'a.pdf')]));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(adminUpload).not.toHaveBeenCalled();
    expect(upload.mock.calls[0]).toHaveLength(2); // (file, options): there is no place to put an owner
  });

  it('administrator uploads go to the chosen user, fixed when the file was added', async () => {
    const { result, rerender } = renderHook(
      ({ target }: { target: string }) => useUploadCentralFiles({ scope: 'admin', targetUserId: target, maxFileBytes: 50 * MB }),
      { wrapper, initialProps: { target: '3' } },
    );
    act(() => result.current.add([new File(['x'], 'for-bob.pdf')]));
    rerender({ target: '4' });
    act(() => result.current.add([new File(['x'], 'for-4.pdf')]));

    await waitFor(() => expect(adminUpload).toHaveBeenCalledTimes(2));
    expect(adminUpload.mock.calls.map((call) => [call[0], call[1].name])).toEqual([
      ['3', 'for-bob.pdf'],
      ['4', 'for-4.pdf'],
    ]);
    expect(upload).not.toHaveBeenCalled();
  });

  it('an administrator upload without a chosen user sends nothing and says why', async () => {
    const { result } = renderHook(() => useUploadCentralFiles({ scope: 'admin', maxFileBytes: 50 * MB }), { wrapper });
    act(() => result.current.add([new File(['x'], 'a.pdf')]));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('failed'));
    expect(result.current.items[0]?.error).toBe('Choose a user first.');
    expect(adminUpload).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
});
