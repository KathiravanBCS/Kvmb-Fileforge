import { useCallback, useRef, useState } from 'react';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { CentralScope } from '../types';
import { describeError, formatWait, isCancelled, isStorageBusy, isUploadLimitReached, validateCentralUpload } from '../utils';
import { useCurrentUserId } from './useCurrentUserId';

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'failed' | 'cancelled';

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  status: UploadStatus;
  /** 0 to 1: how much has been SENT. The server then saves the file to storage, so 1 is not "finished" yet. */
  progress: number;
  error?: string;
  /** Shown while the file waits to be tried again (e.g. the server was busy). */
  notice?: string;
}

interface QueuedUpload {
  id: string;
  file: File;
  /** The owner for administrator uploads, fixed when the file was added (not when it happens to run). */
  targetUserId: string | undefined;
}

/** A busy server (too many uploads running right now) usually frees up within seconds: try the same file again a couple of times. */
const BUSY_RETRIES = 2;
const BUSY_WAIT_DEFAULT_SECONDS = 10;
const BUSY_WAIT_MAX_SECONDS = 30;

/** Waits, but returns false at once if the user cancels meanwhile. */
function pause(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

interface Options {
  scope: CentralScope;
  /** Administrators: whose storage the files go to. Ignored (and never sent) for "My Files". */
  targetUserId?: string;
  maxFileBytes: number;
}

/**
 * Uploads files one after another, each with its own progress and Cancel. A file that fails the local checks (empty, too
 * large, blocked type) is rejected before any request is made; the server repeats every check regardless.
 * Failures show a toast that stays until dismissed; a finished batch shows one summary toast.
 */
export function useUploadCentralFiles({ scope, targetUserId, maxFileBytes }: Options) {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();
  const [items, setItems] = useState<UploadItem[]>([]);
  const queue = useRef<QueuedUpload[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const running = useRef(false);
  const counter = useRef(0);

  const patch = useCallback((id: string, changes: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }, []);

  const uploadOne = useCallback(
    async ({ file, targetUserId: owner }: QueuedUpload, options: { signal: AbortSignal; onProgress: (fraction: number) => void }) => {
      if (scope === 'admin') {
        if (!owner) throw new Error('Choose a user first.');
        await api.centralStorage.admin.upload(owner, file, options);
      } else {
        await api.centralStorage.me.upload(file, options);
      }
    },
    [scope],
  );

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    let succeeded = 0;
    try {
      for (let next = queue.current.shift(); next; next = queue.current.shift()) {
        const controller = new AbortController();
        controllers.current.set(next.id, controller);
        patch(next.id, { status: 'uploading', progress: 0 });
        try {
          for (let attempt = 0; ; attempt += 1) {
            try {
              await uploadOne(next, { signal: controller.signal, onProgress: (fraction) => patch(next.id, { progress: fraction }) });
              patch(next.id, { status: 'done', progress: 1, notice: undefined });
              succeeded += 1;
              break;
            } catch (error) {
              if (isCancelled(error, controller.signal)) {
                patch(next.id, { status: 'cancelled', notice: undefined });
                break;
              }
              if (isStorageBusy(error) && attempt < BUSY_RETRIES) {
                const seconds = Math.min(error.retryAfterSeconds ?? BUSY_WAIT_DEFAULT_SECONDS, BUSY_WAIT_MAX_SECONDS);
                patch(next.id, { status: 'queued', progress: 0, notice: `Storage is busy. Trying again in ${formatWait(seconds)}…` });
                if (!(await pause(seconds * 1000, controller.signal))) {
                  patch(next.id, { status: 'cancelled', notice: undefined });
                  break;
                }
                patch(next.id, { status: 'uploading', progress: 0, notice: undefined });
                continue;
              }
              const message = describeError(error);
              if (isUploadLimitReached(error)) {
                // The allowance is used up: sending the rest of the batch would only be refused too. Say so once.
                patch(next.id, { status: 'failed', error: message, notice: undefined });
                for (const waiting of queue.current.splice(0)) {
                  patch(waiting.id, { status: 'failed', error: `Not uploaded. ${message}` });
                }
                notifications.show({ color: 'yellow', title: 'Upload limit reached', message, autoClose: false });
              } else {
                patch(next.id, { status: 'failed', error: message, notice: undefined });
                notifications.show({ color: 'red', title: `Couldn’t upload ${next.file.name}`, message, autoClose: false });
              }
              break;
            }
          }
        } finally {
          controllers.current.delete(next.id);
        }
      }
    } finally {
      running.current = false;
    }
    if (succeeded > 0) {
      notifications.show({
        color: 'green',
        title: succeeded === 1 ? 'File uploaded' : `${succeeded} files uploaded`,
        message: scope === 'admin' ? 'Uploads for other users are recorded in the audit trail.' : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.centralStorage.all(userId ?? '') });
    }
  }, [patch, queryClient, scope, uploadOne, userId]);

  const add = useCallback(
    (files: File[]) => {
      const added: UploadItem[] = [];
      for (const file of files) {
        counter.current += 1;
        const id = `upload-${counter.current}`;
        const invalid = validateCentralUpload(file, maxFileBytes);
        if (invalid) {
          added.push({ id, name: file.name, size: file.size, status: 'failed', progress: 0, error: invalid });
        } else {
          added.push({ id, name: file.name, size: file.size, status: 'queued', progress: 0 });
          queue.current.push({ id, file, targetUserId });
        }
      }
      if (added.length === 0) return;
      setItems((current) => [...current, ...added]);
      void run();
    },
    [maxFileBytes, run, targetUserId],
  );

  /** Stops an upload that is running (the request is aborted and the server cleans up) or removes one still waiting. */
  const cancel = useCallback(
    (id: string) => {
      const controller = controllers.current.get(id);
      if (controller) {
        controller.abort();
        return;
      }
      const waiting = queue.current.findIndex((entry) => entry.id === id);
      if (waiting >= 0) {
        queue.current.splice(waiting, 1);
        patch(id, { status: 'cancelled' });
      }
    },
    [patch],
  );

  const clearFinished = useCallback(() => {
    setItems((current) => current.filter((item) => item.status === 'queued' || item.status === 'uploading'));
  }, []);

  const busy = items.some((item) => item.status === 'queued' || item.status === 'uploading');

  return { items, add, cancel, clearFinished, busy };
}
