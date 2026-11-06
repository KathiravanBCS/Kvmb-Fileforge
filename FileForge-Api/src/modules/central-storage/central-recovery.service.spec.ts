import { HttpException, Logger, ServiceUnavailableException } from '@nestjs/common';

import type { PrismaService } from '../../prisma/prisma.service';
import { centralWorld, USER } from '../../testing/central-fixtures';
import { createFakePrisma } from '../../testing/fake-prisma';
import { backoffMs, CentralRecoveryService, REVIEW_REASON } from './central-recovery.service';
import { CentralStorageAccessService } from './central-storage-access.service';
import { CentralStorageAuditService } from './central-storage-audit.service';
import type { CentralStorageOneDriveService } from './central-storage-onedrive.service';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const CONFIG = {
  enabled: true,
  intervalMs: MINUTE,
  staleMs: 30 * MINUTE,
  batchSize: 10,
  maxAttempts: 3,
  leaseMs: 5 * MINUTE,
};
const connection = { id: 1n, driveId: 'drive-1', rootItemId: 'root-1', usersFolderItemId: 'users-1', ownerUserId: 1n };

beforeAll(() => {
  for (const level of ['log', 'warn', 'error'] as const)
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

const gate = <T>() => {
  let open!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (open = resolve));
  return { promise, open };
};

function item(over: Record<string, unknown> = {}) {
  return {
    id: 'item-9',
    name: 'x.pdf',
    size: 1000,
    eTag: 'etag-new',
    cTag: 'ctag-new',
    createdDateTime: '2026-11-05T10:00:00Z',
    lastModifiedDateTime: '2026-11-05T11:00:00Z',
    file: { mimeType: 'application/pdf' },
    ...over,
  };
}

function setup(configOver: Partial<typeof CONFIG> = {}) {
  const world = centralWorld();
  let now = Date.now();
  const clock = () => new Date(now);
  world.prisma.clock = clock;
  const config = { ...CONFIG, ...configOver };

  const storage = {
    usableConnection: jest.fn().mockResolvedValue(connection),
    findUserFile: jest.fn().mockResolvedValue(null),
    findItem: jest.fn().mockResolvedValue(null),
    deleteItem: jest.fn().mockResolvedValue(undefined),
  };

  /** A backend instance. Several can share one database (the same tables). */
  const instance = (shared = false) => {
    const prisma = shared ? createFakePrisma(world.tables) : world.prisma;
    prisma.clock = clock;
    const audit = new CentralStorageAuditService(prisma as unknown as PrismaService);
    return new CentralRecoveryService(
      prisma as unknown as PrismaService,
      storage as unknown as CentralStorageOneDriveService,
      audit,
      config,
    );
  };

  const files = world.tables['central_files'];
  const events = world.tables['events'];
  let n = 0;
  /** A row as an interrupted operation leaves it: untouched for two hours. */
  const seed = (status: string, over: Record<string, unknown> = {}) => {
    n += 1;
    const old = new Date(now - 2 * HOUR);
    return files.seed({
      connection_id: 1n,
      owner_user_id: USER.alice,
      uploaded_by: USER.alice,
      display_name: `doc-${n}.pdf`,
      stored_name: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}.pdf`,
      file_extension: 'pdf',
      mime_type: 'application/pdf',
      size_bytes: 1000n,
      external_drive_id: 'drive-1',
      external_item_id: status === 'uploading' || status === 'failed' ? null : `item-${n}`,
      external_etag: status === 'uploading' || status === 'failed' ? null : 'etag-old',
      upload_status: status,
      created_at: old,
      updated_at: old,
      is_deleted: status === 'failed' || status === 'deleting',
      ...over,
    }) as Record<string, unknown> & { id: bigint };
  };
  const row = (id: bigint) => files.rows.find((r) => r['id'] === id)!;
  const auditActions = () => events.rows.map((e) => e['action']);

  return {
    ...world,
    config,
    storage,
    instance,
    service: instance(),
    seed,
    row,
    files,
    events,
    auditActions,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}

describe('backoff', () => {
  it('doubles from 2 minutes and is capped at 6 hours', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([2 * MINUTE, 4 * MINUTE, 8 * MINUTE, 16 * MINUTE]);
    expect(backoffMs(30)).toBe(6 * HOUR);
  });
});

describe('interrupted uploads', () => {
  it('records an upload whose item reached OneDrive but whose record was never finished', async () => {
    const t = setup();
    const file = t.seed('uploading');
    t.storage.findUserFile.mockResolvedValue(item({ id: 'item-77', size: 1000 }));

    const summary = await t.service.runOnce();

    expect(summary).toEqual({ examined: 1, outcomes: { repaired: 1 } });
    expect(t.storage.findUserFile).toHaveBeenCalledWith(USER.alice, file['stored_name']);
    expect(t.row(file.id)).toMatchObject({
      upload_status: 'ready',
      external_item_id: 'item-77',
      external_etag: 'etag-new',
      external_ctag: 'ctag-new',
      size_bytes: 1000n,
      last_error_code: null,
      last_recovery_outcome: 'repaired',
      next_recovery_at: null,
      recovery_lease_token: null,
      recovery_lease_until: null,
    });
    expect(t.storage.deleteItem).not.toHaveBeenCalled();
    expect(t.events.rows[0]).toMatchObject({
      actor_type: 'system',
      actor_user_id: null,
      action: 'central_storage.recovery.repaired',
    });
  });

  it('marks an upload failed (hidden) when nothing ever reached OneDrive', async () => {
    const t = setup();
    const file = t.seed('uploading');
    expect(await t.service.runOnce()).toMatchObject({ outcomes: { repaired: 1 } });
    expect(t.row(file.id)).toMatchObject({
      upload_status: 'failed',
      is_deleted: true,
      last_error_code: 'UPLOAD_INTERRUPTED',
      last_recovery_outcome: 'repaired',
    });
    expect(t.storage.deleteItem).not.toHaveBeenCalled();
  });

  it('treats a legacy "pending" row like an interrupted upload', async () => {
    const t = setup();
    const file = t.seed('pending');
    t.storage.findUserFile.mockResolvedValue(item());
    await t.service.runOnce();
    expect(t.row(file.id)['upload_status']).toBe('ready');
  });

  it.each([
    ['a different size', item({ size: 999 }), REVIEW_REASON.sizeMismatch],
    ['a folder', item({ folder: { childCount: 0 } }), REVIEW_REASON.unexpectedItem],
  ])('hands the file to an administrator, changing nothing, when OneDrive holds %s', async (_name, found, reason) => {
    const t = setup();
    const file = t.seed('uploading');
    t.storage.findUserFile.mockResolvedValue(found);
    expect(await t.service.runOnce()).toMatchObject({ outcomes: { needs_review: 1 } });
    expect(t.row(file.id)).toMatchObject({
      upload_status: 'uploading',
      needs_review: true,
      review_reason: reason,
      last_recovery_outcome: 'needs_review',
      recovery_lease_token: null,
    });
    expect(t.storage.deleteItem).not.toHaveBeenCalled();
    // ...and the worker leaves it alone from now on.
    t.storage.findUserFile.mockClear();
    t.advance(24 * HOUR);
    expect(await t.service.runOnce()).toMatchObject({ examined: 0 });
    expect(t.storage.findUserFile).not.toHaveBeenCalled();
  });

  it('does not touch an upload that may still be running (younger than the stale limit)', async () => {
    const t = setup();
    const recent = new Date(t.now() - 5 * MINUTE);
    const file = t.seed('uploading', { created_at: recent, updated_at: recent });
    expect(await t.service.runOnce()).toEqual({ examined: 0, outcomes: {} });
    expect(t.storage.findUserFile).not.toHaveBeenCalled();
    expect(t.row(file.id)['upload_status']).toBe('uploading');
    t.advance(26 * MINUTE); // now older than 30 minutes
    expect(await t.service.runOnce()).toMatchObject({ examined: 1 });
  });

  it('never touches finished or deleted files', async () => {
    const t = setup();
    t.seed('ready');
    t.seed('deleted');
    expect(await t.service.runOnce()).toEqual({ examined: 0, outcomes: {} });
    expect(t.storage.usableConnection).not.toHaveBeenCalled();
  });
});

describe('interrupted replacements', () => {
  it('keeps the old content when the new content never reached OneDrive (same eTag)', async () => {
    const t = setup();
    const file = t.seed('replacing', {
      pending_size_bytes: 555n,
      pending_checksum_sha256: 'a'.repeat(64),
      content_version: 2,
    });
    t.storage.findItem.mockResolvedValue(item({ eTag: 'etag-old', size: 1000 }));
    expect(await t.service.runOnce()).toMatchObject({ outcomes: { repaired: 1 } });
    expect(t.row(file.id)).toMatchObject({
      upload_status: 'ready',
      size_bytes: 1000n,
      content_version: 2,
      last_error_code: 'REPLACE_INTERRUPTED',
      pending_size_bytes: null,
      pending_checksum_sha256: null,
    });
  });

  it('records a replacement that did land (eTag changed, size is the pending size)', async () => {
    const t = setup();
    const checksum = 'b'.repeat(64);
    const file = t.seed('replacing', {
      pending_size_bytes: 555n,
      pending_checksum_sha256: checksum,
      content_version: 2,
    });
    t.storage.findItem.mockResolvedValue(item({ id: 'item-x', eTag: 'etag-new', size: 555 }));
    expect(await t.service.runOnce()).toMatchObject({ outcomes: { repaired: 1 } });
    expect(t.row(file.id)).toMatchObject({
      upload_status: 'ready',
      size_bytes: 555n,
      checksum_sha256: checksum,
      content_version: 3,
      external_etag: 'etag-new',
      external_ctag: 'ctag-new',
      last_error_code: null,
      pending_size_bytes: null,
      pending_checksum_sha256: null,
    });
  });

  it('hands over a changed file whose size is NOT the pending size', async () => {
    const t = setup();
    const file = t.seed('replacing', { pending_size_bytes: 555n, pending_checksum_sha256: 'c'.repeat(64) });
    t.storage.findItem.mockResolvedValue(item({ eTag: 'etag-other', size: 777 }));
    expect(await t.service.runOnce()).toMatchObject({ outcomes: { needs_review: 1 } });
    expect(t.row(file.id)).toMatchObject({
      upload_status: 'replacing',
      needs_review: true,
      review_reason: REVIEW_REASON.replaceMismatch,
      size_bytes: 1000n,
    });
  });

  it('hands over a legacy replacing row that has no recorded eTag and no pending size', async () => {
    const t = setup();
    const file = t.seed('replacing', { external_etag: null });
    t.storage.findItem.mockResolvedValue(item({ size: 4242 }));
    await t.service.runOnce();
    expect(t.row(file.id)).toMatchObject({ needs_review: true, review_reason: REVIEW_REASON.replaceUnknown });
  });

  it.each([
    ['the item is gone from OneDrive', { external_item_id: 'item-gone' }],
    ['no item id was ever recorded', { external_item_id: null }],
  ])('hands over a replacing file when %s', async (_name, over) => {
    const t = setup();
    const file = t.seed('replacing', over);
    await t.service.runOnce();
    expect(t.row(file.id)).toMatchObject({
      needs_review: true,
      review_reason: REVIEW_REASON.itemMissing,
      upload_status: 'replacing',
    });
  });
});

describe('interrupted deletes', () => {
  it('finishes the delete the owner asked for', async () => {
    const t = setup();
    const file = t.seed('deleting', { external_item_id: 'item-del' });
    t.storage.findItem.mockResolvedValue(item({ id: 'item-del' }));
    expect(await t.service.runOnce()).toMatchObject({ outcomes: { repaired: 1 } });
    expect(t.storage.deleteItem).toHaveBeenCalledTimes(1);
    expect(t.storage.deleteItem).toHaveBeenCalledWith('item-del');
    expect(t.row(file.id)).toMatchObject({ upload_status: 'deleted', is_deleted: true });
  });

  it('only records "deleted" when OneDrive no longer has the item', async () => {
    const t = setup();
    const file = t.seed('deleting', { external_item_id: 'item-del' });
    t.storage.findItem.mockResolvedValue(null);
    await t.service.runOnce();
    expect(t.storage.deleteItem).not.toHaveBeenCalled();
    expect(t.row(file.id)['upload_status']).toBe('deleted');
  });

  it('records "deleted" for a row that never had an item', async () => {
    const t = setup();
    const file = t.seed('deleting', { external_item_id: null });
    await t.service.runOnce();
    expect(t.storage.findItem).not.toHaveBeenCalled();
    expect(t.row(file.id)['upload_status']).toBe('deleted');
  });
});

describe('failed uploads and orphaned OneDrive items', () => {
  it('NEVER deletes an item just because the record says failed: it flags it for an administrator', async () => {
    const t = setup();
    const file = t.seed('failed');
    t.storage.findUserFile.mockResolvedValue(item({ id: 'item-orphan' }));
    expect(await t.service.runOnce()).toMatchObject({ outcomes: { needs_review: 1 } });
    expect(t.storage.deleteItem).not.toHaveBeenCalled();
    expect(t.row(file.id)).toMatchObject({
      upload_status: 'failed',
      needs_review: true,
      review_reason: REVIEW_REASON.orphanItem,
    });
    expect(t.auditActions()).toContain('central_storage.recovery.needs_review');
  });

  it('looks once, finds nothing, and stops looking', async () => {
    const t = setup();
    const file = t.seed('failed');
    expect(await t.service.runOnce()).toMatchObject({ outcomes: { no_action: 1 } });
    expect(t.row(file.id)).toMatchObject({
      last_recovery_outcome: 'no_action',
      next_recovery_at: null,
      needs_review: false,
    });
    t.storage.findUserFile.mockClear();
    t.advance(48 * HOUR);
    expect(await t.service.runOnce()).toEqual({ examined: 0, outcomes: {} });
    expect(t.storage.findUserFile).not.toHaveBeenCalled();
    expect(t.events.rows).toHaveLength(0); // nothing changed, nothing to audit
  });
});

describe('OneDrive connection and errors', () => {
  it('waits (without counting an attempt) while the central OneDrive needs reconnecting, then carries on', async () => {
    const t = setup();
    const file = t.seed('uploading');
    t.storage.usableConnection.mockRejectedValue(
      new ServiceUnavailableException({ code: 'CENTRAL_STORAGE_RECONNECT_REQUIRED', message: 'x' }),
    );
    expect(await t.service.runOnce()).toMatchObject({ outcomes: { reauth_required: 1 } });
    expect(t.row(file.id)).toMatchObject({
      recovery_attempts: 0,
      last_recovery_outcome: 'reauth_required',
      needs_review: false,
    });
    expect(t.row(file.id)['next_recovery_at']).toEqual(new Date(t.now() + 15 * MINUTE));
    expect(t.storage.findUserFile).not.toHaveBeenCalled();

    t.advance(10 * MINUTE);
    expect(await t.service.runOnce()).toEqual({ examined: 0, outcomes: {} }); // not due yet

    t.storage.usableConnection.mockResolvedValue(connection);
    t.storage.findUserFile.mockResolvedValue(item());
    t.advance(6 * MINUTE);
    expect(await t.service.runOnce()).toMatchObject({ outcomes: { repaired: 1 } });
    expect(t.row(file.id)['upload_status']).toBe('ready');
  });

  it('retries transient failures with growing delays, then hands the file over', async () => {
    const t = setup(); // maxAttempts = 3
    const file = t.seed('uploading');
    t.storage.findUserFile.mockRejectedValue(new ServiceUnavailableException({ code: 'CENTRAL_STORAGE_UNAVAILABLE' }));

    expect(await t.service.runOnce()).toMatchObject({ outcomes: { retry_scheduled: 1 } });
    expect(t.row(file.id)).toMatchObject({
      recovery_attempts: 1,
      last_recovery_outcome: 'retry_scheduled',
      recovery_lease_token: null,
    });
    expect(t.row(file.id)['next_recovery_at']).toEqual(new Date(t.now() + 2 * MINUTE));

    t.advance(MINUTE);
    expect(await t.service.runOnce()).toMatchObject({ examined: 0 }); // backing off
    t.advance(2 * MINUTE);
    expect(await t.service.runOnce()).toMatchObject({ outcomes: { retry_scheduled: 1 } });
    expect(t.row(file.id)['recovery_attempts']).toBe(2);
    expect(t.row(file.id)['next_recovery_at']).toEqual(new Date(t.now() + 4 * MINUTE));

    t.advance(5 * MINUTE);
    expect(await t.service.runOnce()).toMatchObject({ outcomes: { needs_review: 1 } });
    expect(t.row(file.id)).toMatchObject({
      recovery_attempts: 3,
      needs_review: true,
      review_reason: REVIEW_REASON.attemptsExhausted,
      upload_status: 'uploading',
    });
  });

  it('treats an unexpected error like a transient one (never crashes the pass)', async () => {
    const t = setup();
    const file = t.seed('uploading');
    t.storage.findUserFile.mockRejectedValue(new Error('boom'));
    expect(await t.service.runOnce()).toMatchObject({ outcomes: { retry_scheduled: 1 } });
    expect(t.row(file.id)['recovery_attempts']).toBe(1);
  });

  it('does not repair a file that belongs to a different OneDrive than the connected one', async () => {
    const t = setup();
    const file = t.seed('uploading', { external_drive_id: 'drive-OLD' });
    await t.service.runOnce();
    expect(t.row(file.id)).toMatchObject({ needs_review: true, review_reason: REVIEW_REASON.driveMismatch });
    expect(t.storage.findUserFile).not.toHaveBeenCalled();
    expect(t.storage.deleteItem).not.toHaveBeenCalled();
  });

  it('keeps a batch going after one file fails', async () => {
    const t = setup();
    t.seed('uploading');
    const second = t.seed('uploading');
    t.storage.findUserFile.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(item());
    expect(await t.service.runOnce()).toMatchObject({ examined: 2, outcomes: { retry_scheduled: 1, repaired: 1 } });
    expect(t.row(second.id)['upload_status']).toBe('ready');
  });

  it('respects the batch size and the stop signal', async () => {
    const t = setup({ batchSize: 2 });
    for (let i = 0; i < 5; i += 1) t.seed('uploading');
    expect((await t.service.runOnce()).examined).toBe(2);
    expect((await t.service.runOnce(() => true)).examined).toBe(0);
  });
});

describe('locking across instances', () => {
  it('two instances running together recover every file exactly once', async () => {
    const t = setup();
    const a = t.instance(true);
    const b = t.instance(true);
    for (let i = 0; i < 6; i += 1) t.seed('uploading');
    t.storage.findUserFile.mockImplementation(async () => {
      await Promise.resolve();
      await Promise.resolve();
      return item();
    });

    const [first, second] = await Promise.all([a.runOnce(), b.runOnce()]);

    expect(first.examined + second.examined).toBe(6);
    expect(t.storage.findUserFile).toHaveBeenCalledTimes(6);
    expect(t.files.rows.every((r) => r['upload_status'] === 'ready' && r['recovery_lease_token'] === null)).toBe(true);
    expect(t.auditActions().filter((a) => a === 'central_storage.recovery.repaired')).toHaveLength(6);
  });

  it('skips a file another worker holds, and takes it over only after its lease has expired', async () => {
    const t = setup();
    const file = t.seed('uploading', {
      recovery_lease_token: '11111111-1111-4111-8111-111111111111',
      recovery_lease_until: new Date(t.now() + 3 * MINUTE),
    });
    t.storage.findUserFile.mockResolvedValue(item());
    expect(await t.service.runOnce()).toEqual({ examined: 0, outcomes: {} });
    expect(t.row(file.id)['upload_status']).toBe('uploading');

    t.advance(4 * MINUTE); // the other worker died: its lease ran out
    expect(await t.service.runOnce()).toMatchObject({ outcomes: { repaired: 1 } });
    expect(t.row(file.id)['upload_status']).toBe('ready');
  });

  it('a worker that stalls past its lease cannot overwrite what the instance that took over decided', async () => {
    const t = setup();
    const slow = t.instance(true);
    const fast = t.instance(true);
    const file = t.seed('uploading');
    const stalled = gate<null>();
    t.storage.findUserFile.mockImplementationOnce(() => stalled.promise); // the slow worker would say "no item": failed
    t.storage.findUserFile.mockResolvedValue(item()); // the fast worker sees the item

    const slowPass = slow.runOnce();
    await new Promise((resolve) => setImmediate(resolve)); // the slow worker holds the lease and waits on OneDrive
    expect(t.row(file.id)['recovery_lease_token']).not.toBeNull();

    t.advance(6 * MINUTE); // its 5-minute lease expires without being renewed
    expect(await fast.runOnce()).toMatchObject({ outcomes: { repaired: 1 } });
    stalled.open(null);

    expect(await slowPass).toMatchObject({ outcomes: { lease_lost: 1 } });
    expect(t.row(file.id)).toMatchObject({ upload_status: 'ready', is_deleted: false }); // the fast worker's decision stands
    expect(t.auditActions().filter((a) => a === 'central_storage.recovery.repaired')).toHaveLength(1);
  });

  it('a stalled worker cannot write even when the file is still in the same status (the lease token decides, not the status)', async () => {
    const t = setup();
    const slow = t.instance(true);
    const fast = t.instance(true);
    const file = t.seed('uploading');
    const stalled = gate<null>();
    t.storage.findUserFile.mockImplementationOnce(() => stalled.promise); // would conclude "no item" -> failed
    t.storage.findUserFile.mockRejectedValueOnce(new Error('boom')); // the worker that took over only schedules a retry

    const slowPass = slow.runOnce();
    await new Promise((resolve) => setImmediate(resolve));
    t.advance(6 * MINUTE);
    expect(await fast.runOnce()).toMatchObject({ outcomes: { retry_scheduled: 1 } });
    expect(t.row(file.id)['upload_status']).toBe('uploading'); // unchanged: only the lease can tell the two workers apart
    stalled.open(null);

    expect(await slowPass).toMatchObject({ outcomes: { lease_lost: 1 } });
    expect(t.row(file.id)).toMatchObject({ upload_status: 'uploading', is_deleted: false, recovery_attempts: 1 });
  });

  it('a worker whose lease has run out writes nothing, even if nobody has taken over yet', async () => {
    const t = setup();
    const file = t.seed('uploading');
    const stalled = gate<null>();
    t.storage.findUserFile.mockImplementationOnce(() => stalled.promise);

    const pass = t.service.runOnce();
    await new Promise((resolve) => setImmediate(resolve));
    t.advance(6 * MINUTE); // the 5-minute lease is over; no other worker has claimed the file
    stalled.open(null);

    expect(await pass).toMatchObject({ outcomes: { lease_lost: 1 } });
    expect(t.row(file.id)).toMatchObject({ upload_status: 'uploading', is_deleted: false });
  });

  it('keeps its lease alive through a long operation (renewed before every OneDrive call)', async () => {
    const t = setup(); // lease: 5 minutes
    const other = t.instance(true);
    const file = t.seed('deleting', { external_item_id: 'item-del' });
    const find = gate<ReturnType<typeof item>>();
    const remove = gate<undefined>();
    t.storage.findItem.mockImplementationOnce(() => find.promise);
    t.storage.deleteItem.mockImplementationOnce(() => remove.promise);

    const pass = t.service.runOnce();
    await new Promise((resolve) => setImmediate(resolve));
    t.advance(4 * MINUTE);
    find.open(item({ id: 'item-del' }));
    await new Promise((resolve) => setImmediate(resolve));
    t.advance(4 * MINUTE); // 8 minutes since the claim: longer than ONE lease, shorter than two renewed ones

    expect(await other.runOnce()).toEqual({ examined: 0, outcomes: {} }); // still owned
    remove.open(undefined);
    expect(await pass).toMatchObject({ outcomes: { repaired: 1 } });
    expect(t.row(file.id)['upload_status']).toBe('deleted');
    expect(t.storage.deleteItem).toHaveBeenCalledTimes(1);
  });

  it('writes nothing if a user operation changed the file while the worker was looking', async () => {
    const t = setup();
    const file = t.seed('replacing');
    t.storage.findItem.mockImplementation(async () => {
      // The owner deletes the file while recovery is talking to OneDrive.
      t.row(file.id)['upload_status'] = 'deleting';
      return item({ eTag: 'etag-old' });
    });
    expect(await t.service.runOnce()).toMatchObject({ outcomes: { lease_lost: 1 } });
    expect(t.row(file.id)['upload_status']).toBe('deleting');
  });
});

describe('recovery on administrator request', () => {
  it('recovers a file that was waiting for review, resetting its attempts', async () => {
    const t = setup();
    const file = t.seed('uploading', {
      needs_review: true,
      review_reason: REVIEW_REASON.attemptsExhausted,
      recovery_attempts: 3,
    });
    t.storage.findUserFile.mockResolvedValue(item());
    const admin = await new CentralStorageAccessService(t.prisma as unknown as PrismaService).adminActor(
      { id: '1', email: 'admin@example.com', displayName: null },
      { requestId: 'req-9' },
    );

    expect(await t.service.recoverNow(file.id, admin)).toBe('repaired');
    expect(t.row(file.id)).toMatchObject({ upload_status: 'ready', needs_review: false, review_reason: null });
    expect(t.events.rows[0]).toMatchObject({
      actor_type: 'system_admin',
      actor_user_id: USER.admin,
      action: 'central_storage.recovery.repaired',
      request_id: 'req-9',
    });
  });

  it('says "busy" when a worker holds the file, and "not recoverable" for a healthy file', async () => {
    const t = setup();
    const held = t.seed('uploading', {
      recovery_lease_token: '22222222-2222-4222-8222-222222222222',
      recovery_lease_until: new Date(t.now() + MINUTE),
    });
    const fine = t.seed('ready');
    const admin = { userId: USER.admin, isAdmin: true };
    expect(await t.service.recoverNow(held.id, admin)).toBe('busy');
    expect(await t.service.recoverNow(fine.id, admin)).toBe('not_recoverable');
    expect(await t.service.recoverNow(999n, admin)).toBe('not_recoverable');
    expect(t.row(held.id)['recovery_lease_token']).toBe('22222222-2222-4222-8222-222222222222'); // untouched
  });
});

describe('clock', () => {
  it('uses the database clock, not the process clock', async () => {
    const t = setup();
    t.seed('uploading', {
      recovery_lease_token: '33333333-3333-4333-8333-333333333333',
      recovery_lease_until: new Date(t.now() + MINUTE),
    });
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * HOUR); // a wildly wrong process clock
    try {
      expect(await t.service.runOnce()).toEqual({ examined: 0, outcomes: {} }); // the lease is still valid by the database's clock
    } finally {
      spy.mockRestore();
    }
  });

  it('exposes HttpException codes it understands', () => {
    expect(new HttpException({ code: 'X' }, 500).getResponse()).toMatchObject({ code: 'X' });
  });
});
