import { Logger } from '@nestjs/common';

import type { PrismaService } from '../../prisma/prisma.service';
import { centralWorld, USER } from '../../testing/central-fixtures';
import { CentralRecoveryAdminService, explain } from './central-recovery-admin.service';
import { CentralRecoveryService, REVIEW_REASON } from './central-recovery.service';
import { CentralStorageAccessService } from './central-storage-access.service';
import { CentralStorageAuditService } from './central-storage-audit.service';
import type { CentralStorageOneDriveService } from './central-storage-onedrive.service';
import type { RecoveryListQuery } from './dto/central-recovery.dto';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const CONFIG = {
  enabled: false,
  intervalMs: MINUTE,
  staleMs: 30 * MINUTE,
  batchSize: 10,
  maxAttempts: 6,
  leaseMs: 5 * MINUTE,
};
const connection = { id: 1n, driveId: 'drive-1', rootItemId: 'r', usersFolderItemId: 'u', ownerUserId: 1n };
const query = (state: RecoveryListQuery['state'] = 'all'): RecoveryListQuery => ({ page: 1, pageSize: 25, state });

beforeAll(() => {
  for (const level of ['log', 'warn', 'error'] as const)
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

async function setup() {
  const world = centralWorld();
  const prisma = world.prisma as unknown as PrismaService;
  const storage = {
    usableConnection: jest.fn().mockResolvedValue(connection),
    findUserFile: jest.fn().mockResolvedValue(null),
    findItem: jest.fn().mockResolvedValue(null),
    deleteItem: jest.fn().mockResolvedValue(undefined),
  };
  const access = new CentralStorageAccessService(prisma);
  const audit = new CentralStorageAuditService(prisma);
  const recovery = new CentralRecoveryService(
    prisma,
    storage as unknown as CentralStorageOneDriveService,
    audit,
    CONFIG,
  );
  const service = new CentralRecoveryAdminService(prisma, recovery, access, audit, CONFIG);
  const admin = await access.adminActor({ id: '1', email: 'a@example.com', displayName: null }, { requestId: 'req-5' });
  const alice = { userId: USER.alice, isAdmin: false };
  const files = world.tables['central_files'];
  let n = 0;
  const seed = (status: string, over: Record<string, unknown> = {}) => {
    n += 1;
    const old = new Date(Date.now() - 2 * HOUR);
    return files.seed({
      connection_id: 1n,
      owner_user_id: USER.alice,
      uploaded_by: USER.alice,
      display_name: `doc-${n}.pdf`,
      stored_name: `SECRET-STORED-NAME-${n}.pdf`,
      file_extension: 'pdf',
      mime_type: 'application/pdf',
      size_bytes: 1000n,
      external_drive_id: 'drive-1',
      external_item_id: `SECRET-ITEM-${n}`,
      external_etag: 'SECRET-ETAG',
      checksum_sha256: 'f'.repeat(64),
      upload_status: status,
      created_at: old,
      updated_at: old,
      ...over,
    }) as Record<string, unknown> & { id: bigint };
  };
  return { ...world, service, storage, admin, alice, files, seed, events: world.tables['events'] };
}

describe('access', () => {
  it('only a system administrator can use any of it', async () => {
    const t = await setup();
    const file = t.seed('uploading');
    for (const call of [
      () => t.service.summary(t.alice),
      () => t.service.list(t.alice, query()),
      () => t.service.detail(t.alice, file.id.toString()),
      () => t.service.retry(t.alice, file.id.toString()),
      () => t.service.dismiss(t.alice, file.id.toString()),
    ]) {
      await expect(call()).rejects.toMatchObject({ status: 403 });
    }
    expect(t.storage.findUserFile).not.toHaveBeenCalled();
    expect(t.events.rows).toHaveLength(0);
  });

  it('administrator rights are rechecked in the database (a revoked grant stops working at once)', async () => {
    const t = await setup();
    t.tables['system_admins'].rows[0]['is_deleted'] = true;
    await expect(t.service.summary(t.admin)).rejects.toMatchObject({ status: 403 });
  });
});

describe('summary', () => {
  it('counts what needs attention and reports the worker settings', async () => {
    const t = await setup();
    t.seed('uploading', { needs_review: true, review_reason: REVIEW_REASON.sizeMismatch });
    t.seed('failed', { needs_review: true, review_reason: REVIEW_REASON.orphanItem });
    t.seed('uploading', { recovery_attempts: 2 });
    t.seed('uploading', { last_recovery_outcome: 'reauth_required', last_recovery_at: new Date() });
    t.seed('replacing'); // waiting
    t.seed('failed', { last_recovery_outcome: 'no_action', last_recovery_at: new Date(Date.now() - HOUR) }); // resolved: not counted
    t.seed('ready', { last_recovery_outcome: 'repaired', last_recovery_at: new Date(Date.now() - HOUR) });
    t.seed('ready'); // healthy

    expect(await t.service.summary(t.admin)).toMatchObject({
      worker: { enabled: false, intervalSeconds: 60, staleMinutes: 30, maxAttempts: 6 },
      needsReview: 2,
      retrying: 2,
      waiting: 1,
      reauthRequired: 1,
      repairedLast24h: 1,
    });
  });

  it('is all zero and has no last run on a healthy system', async () => {
    const t = await setup();
    t.seed('ready');
    expect(await t.service.summary(t.admin)).toMatchObject({
      needsReview: 0,
      retrying: 0,
      waiting: 0,
      reauthRequired: 0,
      repairedLast24h: 0,
      lastRecoveryAt: null,
    });
  });
});

describe('list', () => {
  it('lists the three queues, review first, and filters by state', async () => {
    const t = await setup();
    const waiting = t.seed('uploading');
    const retrying = t.seed('deleting', { recovery_attempts: 1 });
    const review = t.seed('failed', { needs_review: true, review_reason: REVIEW_REASON.orphanItem });
    t.seed('ready');
    t.seed('uploading', { created_at: new Date(), updated_at: new Date() }); // too fresh to be "interrupted"

    const all = await t.service.list(t.admin, query());
    expect(all.total).toBe(3);
    expect(all.items.map((item) => item.id)).toEqual([review.id, retrying.id, waiting.id].map(String));
    expect(all.items.map((item) => item.state)).toEqual(['needs_review', 'retrying', 'waiting']);
    expect((await t.service.list(t.admin, query('needs_review'))).items.map((i) => i.id)).toEqual([String(review.id)]);
    expect((await t.service.list(t.admin, query('retrying'))).items.map((i) => i.id)).toEqual([String(retrying.id)]);
    expect((await t.service.list(t.admin, query('waiting'))).items.map((i) => i.id)).toEqual([String(waiting.id)]);
  });

  it('paginates', async () => {
    const t = await setup();
    for (let i = 0; i < 5; i += 1) t.seed('uploading');
    const page = await t.service.list(t.admin, { page: 2, pageSize: 2, state: 'all' });
    expect(page).toMatchObject({ page: 2, pageSize: 2, total: 5 });
    expect(page.items).toHaveLength(2);
  });

  it('shows the owner and a plain-language explanation, and NEVER OneDrive ids, stored names, etags or checksums', async () => {
    const t = await setup();
    t.seed('failed', { needs_review: true, review_reason: REVIEW_REASON.orphanItem });
    const { items } = await t.service.list(t.admin, query());
    expect(items[0]).toMatchObject({
      owner: { id: '2', email: 'alice@example.com' },
      reviewReason: 'orphan_onedrive_item',
      explanation: expect.stringContaining('NOT deleted'),
    });
    const text = JSON.stringify(items);
    for (const secret of ['SECRET-STORED-NAME', 'SECRET-ITEM', 'SECRET-ETAG', 'f'.repeat(64), 'drive-1']) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('detail', () => {
  it('returns the file and its recovery history only', async () => {
    const t = await setup();
    const file = t.seed('uploading');
    t.storage.findUserFile.mockResolvedValue({ id: 'item-1', size: 1000, eTag: 'e', file: {} });
    await t.service.retry(t.admin, file.id.toString());
    t.events.seed({ action: 'central_storage.file.download', entity_type_id: 10n, entity_id: file.id }); // not recovery
    t.events.seed({ action: 'central_storage.recovery.repaired', entity_type_id: 10n, entity_id: 999n }); // another file

    const detail = await t.service.detail(t.admin, file.id.toString());
    expect(detail.item).toMatchObject({ id: String(file.id), status: 'ready' });
    expect(detail.events.map((e) => e.action).sort()).toEqual([
      'central_storage.recovery.repaired',
      'central_storage.recovery.retry_requested',
    ]);
    expect(JSON.stringify(detail)).not.toContain('SECRET');
  });

  it.each(['abc', '0', '99999999999999999999', '999'])('404 for an unknown or malformed id (%s)', async (id) => {
    const t = await setup();
    await expect(t.service.detail(t.admin, id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('retry', () => {
  it('records the request first, then recovers the file and reports the result', async () => {
    const t = await setup();
    const file = t.seed('uploading', {
      needs_review: true,
      review_reason: REVIEW_REASON.attemptsExhausted,
      recovery_attempts: 6,
    });
    t.storage.findUserFile.mockResolvedValue({ id: 'item-1', size: 1000, eTag: 'e', file: {} });

    const result = await t.service.retry(t.admin, file.id.toString());

    expect(result.outcome).toBe('repaired');
    expect(result.item).toMatchObject({ status: 'ready', state: 'waiting', attempts: 0 });
    expect(t.events.rows.map((e) => e['action'])).toEqual([
      'central_storage.recovery.retry_requested',
      'central_storage.recovery.repaired',
    ]);
    expect(t.events.rows[0]).toMatchObject({
      actor_type: 'system_admin',
      actor_user_id: USER.admin,
      request_id: 'req-5',
    });
  });

  it('does nothing if the request cannot be recorded (fail closed)', async () => {
    const t = await setup();
    const file = t.seed('uploading');
    t.events.create = jest.fn().mockRejectedValue(new Error('audit down'));
    await expect(t.service.retry(t.admin, file.id.toString())).rejects.toThrow('audit down');
    expect(t.storage.findUserFile).not.toHaveBeenCalled();
  });

  it('409 when a worker is on the file, 409 when there is nothing to recover, 404 when it does not exist', async () => {
    const t = await setup();
    const busy = t.seed('uploading', {
      recovery_lease_token: '55555555-5555-4555-8555-555555555555',
      recovery_lease_until: new Date(Date.now() + MINUTE),
    });
    const fine = t.seed('ready');
    await expect(t.service.retry(t.admin, busy.id.toString())).rejects.toMatchObject({
      status: 409,
      response: { code: 'RECOVERY_BUSY' },
    });
    await expect(t.service.retry(t.admin, fine.id.toString())).rejects.toMatchObject({
      status: 409,
      response: { code: 'NOT_RECOVERABLE' },
    });
    await expect(t.service.retry(t.admin, '4242')).rejects.toMatchObject({ status: 404 });
  });
});

describe('dismiss', () => {
  it('takes a file out of the review queue without touching OneDrive or the file', async () => {
    const t = await setup();
    const file = t.seed('failed', { needs_review: true, review_reason: REVIEW_REASON.orphanItem });
    const result = await t.service.dismiss(t.admin, file.id.toString());

    expect(result.item.state).not.toBe('needs_review');
    expect(t.files.rows[0]).toMatchObject({
      needs_review: false,
      review_reason: null,
      last_recovery_outcome: 'no_action',
      next_recovery_at: null,
      upload_status: 'failed',
    });
    expect(Object.values(t.storage).every((fn) => fn.mock.calls.length === 0)).toBe(true);
    expect(t.events.rows[0]).toMatchObject({
      action: 'central_storage.recovery.dismissed',
      actor_user_id: USER.admin,
      new_values: expect.objectContaining({ reason: 'orphan_onedrive_item' }),
    });
    expect((await t.service.list(t.admin, query())).total).toBe(0);
  });

  it('409 for a file that is not waiting for review', async () => {
    const t = await setup();
    const file = t.seed('uploading');
    await expect(t.service.dismiss(t.admin, file.id.toString())).rejects.toMatchObject({
      status: 409,
      response: { code: 'NOT_IN_REVIEW' },
    });
  });

  it('409 while a worker holds the file', async () => {
    const t = await setup();
    const file = t.seed('uploading', {
      needs_review: true,
      review_reason: REVIEW_REASON.sizeMismatch,
      recovery_lease_token: '66666666-6666-4666-8666-666666666666',
      recovery_lease_until: new Date(Date.now() + MINUTE),
    });
    await expect(t.service.dismiss(t.admin, file.id.toString())).rejects.toMatchObject({ status: 409 });
    expect(t.files.rows[0]['needs_review']).toBe(true);
  });
});

describe('explain', () => {
  const base = { needs_review: false, review_reason: null, recovery_attempts: 0, last_recovery_outcome: null };
  it.each([
    [
      'review reason',
      { needs_review: true, review_reason: REVIEW_REASON.replaceMismatch, upload_status: 'replacing' },
      /does not match/,
    ],
    [
      'unknown review reason',
      { needs_review: true, review_reason: 'whatever', upload_status: 'uploading' },
      /needs to look/,
    ],
    ['reauth', { last_recovery_outcome: 'reauth_required', upload_status: 'uploading' }, /reconnected/],
    ['retrying', { recovery_attempts: 2, upload_status: 'deleting' }, /Tried 2 of 6/],
    ['waiting upload', { upload_status: 'uploading' }, /interrupted/],
    ['waiting delete', { upload_status: 'deleting' }, /finish removing/],
  ])('%s', (_name, over, expected) => {
    expect(explain({ ...base, ...over } as never, 6)).toMatch(expected);
  });
});
