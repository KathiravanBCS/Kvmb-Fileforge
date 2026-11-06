import { Logger } from '@nestjs/common';

import type { CentralRecoveryService } from './central-recovery.service';
import { CentralRecoveryWorker } from './central-recovery.worker';
import type { CentralUploadAdmissionService } from './central-upload-admission.service';

const MINUTE = 60_000;
const CONFIG = {
  enabled: true,
  intervalMs: MINUTE,
  staleMs: 30 * MINUTE,
  batchSize: 10,
  maxAttempts: 6,
  leaseMs: 5 * MINUTE,
};

function setup(over: Partial<typeof CONFIG> = {}) {
  const recovery = { runOnce: jest.fn().mockResolvedValue({ examined: 0, outcomes: {} }) };
  const admission = { housekeeping: jest.fn().mockResolvedValue({ expired: 0, deleted: 0 }) };
  const worker = new CentralRecoveryWorker(
    recovery as unknown as CentralRecoveryService,
    admission as unknown as CentralUploadAdmissionService,
    { ...CONFIG, ...over },
  );
  return { worker, recovery, admission };
}

beforeEach(() => {
  jest.useFakeTimers();
  for (const level of ['log', 'warn', 'error'] as const)
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('CentralRecoveryWorker', () => {
  it('does not run anything at startup, only after an interval', async () => {
    const { worker, recovery } = setup();
    worker.onApplicationBootstrap();
    expect(recovery.runOnce).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(MINUTE);
    expect(recovery.runOnce).toHaveBeenCalledTimes(1);
    await worker.onModuleDestroy();
  });

  it('with recovery disabled, no recovery pass ever runs, but slot housekeeping still does', async () => {
    const { worker, recovery, admission } = setup({ enabled: false });
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(30 * MINUTE);
    expect(recovery.runOnce).not.toHaveBeenCalled();
    expect(admission.housekeeping).toHaveBeenCalled();
    await worker.onModuleDestroy();
  });

  it('never starts a pass while the previous one is still running', async () => {
    const { worker, recovery } = setup();
    let finish: () => void = () => undefined;
    recovery.runOnce.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ examined: 1, outcomes: {} });
        }),
    );
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(5 * MINUTE);
    expect(recovery.runOnce).toHaveBeenCalledTimes(1); // four more ticks went by, none overlapped
    finish();
    await jest.advanceTimersByTimeAsync(MINUTE);
    expect(recovery.runOnce).toHaveBeenCalledTimes(2);
    finish();
    await worker.onModuleDestroy();
  });

  it('keeps going after a failed pass', async () => {
    const { worker, recovery } = setup();
    recovery.runOnce.mockRejectedValueOnce(new Error('db down'));
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(3 * MINUTE);
    expect(recovery.runOnce).toHaveBeenCalledTimes(3);
    await worker.onModuleDestroy();
  });

  it('on shutdown it stops the timers, asks the pass to stop, and waits for it', async () => {
    const { worker, recovery } = setup();
    let stopping: () => boolean = () => false;
    let finish: () => void = () => undefined;
    recovery.runOnce.mockImplementation((isStopping: () => boolean) => {
      stopping = isStopping;
      return new Promise((resolve) => {
        finish = () => resolve({ examined: 0, outcomes: {} });
      });
    });
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(MINUTE);
    expect(stopping()).toBe(false);

    let destroyed = false;
    const destroying = worker.onModuleDestroy().then(() => (destroyed = true));
    await Promise.resolve();
    expect(stopping()).toBe(true);
    expect(destroyed).toBe(false); // still waiting for the pass in progress
    finish();
    await destroying;
    expect(destroyed).toBe(true);

    await jest.advanceTimersByTimeAsync(10 * MINUTE);
    expect(recovery.runOnce).toHaveBeenCalledTimes(1); // no timers left
  });

  it('timers do not keep the process alive', () => {
    const { worker } = setup();
    const spy = jest.spyOn(global, 'setInterval');
    worker.onApplicationBootstrap();
    for (const result of spy.mock.results) expect((result.value as { hasRef(): boolean }).hasRef()).toBe(false);
    void worker.onModuleDestroy();
  });
});
