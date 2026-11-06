import { HttpException } from '@nestjs/common';

import { centralTables, USER } from '../../testing/central-fixtures';
import { createFakePrisma, Mutex, type FakePrisma, type FakeTables } from '../../testing/fake-prisma';
import { CENTRAL_ADMISSION_LOCK_KEY, CENTRAL_HOUSEKEEPING_LOCK_KEY } from './central-storage.constants';
import { CentralUploadAdmissionService, type UploadSlot } from './central-upload-admission.service';

const MINUTE = 60_000;
const CONFIG = {
  windowMs: 10 * MINUTE,
  userUploadLimit: 10,
  userReplaceLimit: 10,
  adminUploadLimit: 60,
  maxConcurrentPerUser: 3,
  maxConcurrentGlobal: 8,
  slotLeaseMs: 30 * MINUTE,
};

interface Instance {
  prisma: FakePrisma;
  service: CentralUploadAdmissionService;
}

/** One database (tables + locks + clock), any number of "backend instances" on it. */
function world(config = CONFIG) {
  const tables: FakeTables = centralTables();
  const mutex = new Mutex();
  let now = new Date('2026-01-01T12:00:00Z').getTime();
  const clock = () => new Date(now);
  const instance = (): Instance => {
    const prisma = createFakePrisma(tables, { mutex });
    prisma.clock = clock;
    return { prisma, service: new CentralUploadAdmissionService(prisma as never, config) };
  };
  return {
    tables,
    instance,
    advance: (ms: number) => {
      now += ms;
    },
    slots: () => tables['central_upload_slots'].rows,
  };
}

async function rejection(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('expected the call to be refused');
}

const body = (error: HttpException) =>
  error.getResponse() as { code: string; message: string; retryAfterSeconds: number };

describe('CentralUploadAdmissionService', () => {
  describe('rate window', () => {
    it('allows 10 uploads per user per 10 minutes and refuses the 11th with 429 and a retry time', async () => {
      const w = world();
      const { service } = w.instance();
      for (let i = 0; i < 10; i += 1) {
        const slot = await service.admit(USER.alice, 'upload');
        await service.release(slot, 'completed'); // finished uploads still count towards the window
        w.advance(10_000);
      }
      const error = await rejection(service.admit(USER.alice, 'upload'));
      expect(error.getStatus()).toBe(429);
      expect(body(error).code).toBe('UPLOAD_RATE_LIMITED');
      // The oldest admission (100 s ago) leaves the window in 500 s.
      expect(body(error).retryAfterSeconds).toBe(500);
      expect(body(error).message).toMatch(/10 uploads per 10 minutes/);
    });

    it('lets the user upload again once the oldest admission leaves the window (sliding)', async () => {
      const w = world();
      const { service } = w.instance();
      for (let i = 0; i < 10; i += 1) await service.release(await service.admit(USER.alice, 'upload'), 'completed');
      await rejection(service.admit(USER.alice, 'upload'));
      w.advance(10 * MINUTE + 1);
      await expect(service.admit(USER.alice, 'upload')).resolves.toMatchObject({ token: expect.any(String) });
    });

    it('counts uploads and replacements separately, 10 each', async () => {
      const w = world();
      const { service } = w.instance();
      for (let i = 0; i < 10; i += 1) await service.release(await service.admit(USER.alice, 'upload'), 'completed');
      for (let i = 0; i < 10; i += 1) await service.release(await service.admit(USER.alice, 'replace'), 'completed');
      expect(body(await rejection(service.admit(USER.alice, 'upload'))).code).toBe('UPLOAD_RATE_LIMITED');
      const replace = await rejection(service.admit(USER.alice, 'replace'));
      expect(body(replace).code).toBe('UPLOAD_RATE_LIMITED');
      expect(body(replace).message).toMatch(/replacements/);
    });

    it('limits administrator uploads on behalf of users to 60 per 10 minutes', async () => {
      const w = world();
      const { service } = w.instance();
      for (let i = 0; i < 60; i += 1)
        await service.release(await service.admit(USER.admin, 'admin_upload'), 'completed');
      expect(body(await rejection(service.admit(USER.admin, 'admin_upload'))).code).toBe('UPLOAD_RATE_LIMITED');
      // ...and it is not the administrator's personal upload allowance.
      await expect(service.admit(USER.admin, 'upload')).resolves.toBeDefined();
    });

    it("does not let one user use up another user's allowance", async () => {
      const w = world();
      const { service } = w.instance();
      for (let i = 0; i < 10; i += 1) await service.release(await service.admit(USER.alice, 'upload'), 'completed');
      await rejection(service.admit(USER.alice, 'upload'));
      await expect(service.admit(USER.bob, 'upload')).resolves.toBeDefined();
    });

    it('a refused request consumes nothing', async () => {
      const w = world();
      const { service } = w.instance();
      for (let i = 0; i < 10; i += 1) await service.release(await service.admit(USER.alice, 'upload'), 'completed');
      const before = w.slots().length;
      for (let i = 0; i < 5; i += 1) await rejection(service.admit(USER.alice, 'upload'));
      expect(w.slots()).toHaveLength(before);
    });
  });

  describe('concurrency', () => {
    it('allows 3 running uploads per user and refuses the 4th until one finishes', async () => {
      const w = world();
      const { service } = w.instance();
      const held: UploadSlot[] = [];
      for (let i = 0; i < 3; i += 1) held.push(await service.admit(USER.alice, 'upload'));
      const error = await rejection(service.admit(USER.alice, 'upload'));
      expect(error.getStatus()).toBe(429);
      expect(body(error).code).toBe('UPLOAD_TOO_MANY_ACTIVE');
      expect(body(error).retryAfterSeconds).toBeGreaterThanOrEqual(1);

      await service.release(held[0], 'completed');
      await expect(service.admit(USER.alice, 'upload')).resolves.toBeDefined();
    });

    it('frees the slot when the upload failed or was cancelled', async () => {
      const w = world();
      const { service } = w.instance();
      const slots = [
        await service.admit(USER.alice, 'upload'),
        await service.admit(USER.alice, 'upload'),
        await service.admit(USER.alice, 'upload'),
      ];
      await service.release(slots[0], 'failed');
      await service.release(slots[1], 'cancelled');
      await expect(service.admit(USER.alice, 'upload')).resolves.toBeDefined();
      expect(w.slots().map((s) => s['outcome'])).toEqual(expect.arrayContaining(['failed', 'cancelled']));
    });

    it('counts replacements and admin uploads in the same per-user concurrency', async () => {
      const w = world();
      const { service } = w.instance();
      await service.admit(USER.alice, 'upload');
      await service.admit(USER.alice, 'replace');
      await service.admit(USER.alice, 'replace');
      expect(body(await rejection(service.admit(USER.alice, 'upload'))).code).toBe('UPLOAD_TOO_MANY_ACTIVE');
    });

    it('caps running uploads across all users at 8, administrators included', async () => {
      const w = world();
      const { service } = w.instance();
      const users = [USER.alice, USER.bob, USER.admin];
      let admitted = 0;
      for (const user of users) {
        for (let i = 0; i < 3 && admitted < 8; i += 1) {
          await service.admit(user, user === USER.admin ? 'admin_upload' : 'upload');
          admitted += 1;
        }
      }
      expect(admitted).toBe(8);
      // A ninth user is refused although they have nothing running themselves.
      const error = await rejection(service.admit(5n, 'upload'));
      expect(body(error).code).toBe('UPLOAD_CAPACITY_BUSY');
      expect(error.getStatus()).toBe(429);
      // The administrator's slot counts too: freeing it makes room.
      const adminSlot = w.slots().find((s) => s['user_id'] === USER.admin)!;
      await service.release({ id: adminSlot['id'] as bigint, token: adminSlot['lease_token'] as string }, 'completed');
      await expect(service.admit(5n, 'upload')).resolves.toBeDefined();
    });

    it("checks global capacity before the user's own limits (a busy server is reported as busy)", async () => {
      const w = world({ ...CONFIG, maxConcurrentGlobal: 1 });
      const { service } = w.instance();
      await service.admit(USER.alice, 'upload');
      expect(body(await rejection(service.admit(USER.alice, 'upload'))).code).toBe('UPLOAD_CAPACITY_BUSY');
    });
  });

  describe('atomic admission', () => {
    it('takes the admission advisory lock before it reads anything', async () => {
      const w = world();
      const { prisma, service } = w.instance();
      await service.admit(USER.alice, 'upload');
      expect(prisma.rawLog[0]).toContain('pg_advisory_xact_lock(');
      expect(w.tables['central_upload_slots'].calls[0]).not.toBe('create');
      expect(CENTRAL_ADMISSION_LOCK_KEY).not.toBe(CENTRAL_HOUSEKEEPING_LOCK_KEY);
    });

    it('20 parallel requests from one user admit exactly 3', async () => {
      const w = world();
      const { service } = w.instance();
      const results = await Promise.allSettled(Array.from({ length: 20 }, () => service.admit(USER.alice, 'upload')));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      expect(w.slots().filter((s) => s['released_at'] === null)).toHaveLength(3);
      const codes = results.flatMap((r) => (r.status === 'rejected' ? [body(r.reason as HttpException).code] : []));
      expect(new Set(codes)).toEqual(new Set(['UPLOAD_TOO_MANY_ACTIVE']));
    });

    it('parallel requests cannot exceed the 10-per-window rate limit', async () => {
      const w = world({ ...CONFIG, maxConcurrentPerUser: 50, maxConcurrentGlobal: 50 });
      const { service } = w.instance();
      const results = await Promise.allSettled(Array.from({ length: 25 }, () => service.admit(USER.alice, 'upload')));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
      expect(w.slots()).toHaveLength(10);
    });

    it('two backend instances sharing one database never exceed the global cap of 8', async () => {
      const w = world();
      const a = w.instance();
      const b = w.instance();
      const users = [10n, 11n, 12n, 13n, 14n, 15n];
      const calls = users.flatMap((user) =>
        [a, b].flatMap((instance) => [instance.service.admit(user, 'upload'), instance.service.admit(user, 'upload')]),
      );
      const results = await Promise.allSettled(calls);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(8);
      expect(w.slots().filter((s) => s['released_at'] === null)).toHaveLength(8);
      for (const user of users) {
        expect(w.slots().filter((s) => s['user_id'] === user && s['released_at'] === null).length).toBeLessThanOrEqual(
          3,
        );
      }
    });
  });

  describe('release', () => {
    it("only the holder's own token can release a slot", async () => {
      const w = world();
      const { service } = w.instance();
      const mine = await service.admit(USER.alice, 'upload');
      const theirs = await service.admit(USER.bob, 'upload');

      expect(await service.release({ id: mine.id, token: theirs.token }, 'completed')).toBe(false);
      expect(await service.release({ id: mine.id, token: '00000000-0000-4000-8000-000000000000' }, 'completed')).toBe(
        false,
      );
      expect(w.slots().every((s) => s['released_at'] === null)).toBe(true);

      expect(await service.release(mine, 'completed')).toBe(true);
      expect(w.slots().filter((s) => s['released_at'] !== null)).toHaveLength(1);
      expect(w.slots().find((s) => s['id'] === theirs.id)!['released_at']).toBeNull();
    });

    it('releasing twice does nothing the second time', async () => {
      const w = world();
      const { service } = w.instance();
      const slot = await service.admit(USER.alice, 'upload');
      expect(await service.release(slot, 'completed')).toBe(true);
      expect(await service.release(slot, 'failed')).toBe(false);
      expect(w.slots()[0]['outcome']).toBe('completed');
    });

    it('never returns the token in any stored identifier other than the lease_token column', async () => {
      const w = world();
      const { service } = w.instance();
      const slot = await service.admit(USER.alice, 'upload', 'req-1');
      const row = w.slots()[0];
      expect(row['request_id']).toBe('req-1');
      expect(row['lease_token']).toBe(slot.token);
      expect(String(row['id'])).not.toBe(slot.token);
    });
  });

  describe('lease expiry', () => {
    it('frees a slot whose instance died, so it never blocks anybody', async () => {
      const w = world();
      const { service } = w.instance();
      const dead = [
        await service.admit(USER.alice, 'upload'),
        await service.admit(USER.alice, 'upload'),
        await service.admit(USER.alice, 'upload'),
      ];
      expect(body(await rejection(service.admit(USER.alice, 'upload'))).code).toBe('UPLOAD_TOO_MANY_ACTIVE');

      w.advance(31 * MINUTE);
      await expect(service.admit(USER.alice, 'upload')).resolves.toBeDefined();
      expect(w.slots().filter((s) => s['outcome'] === 'expired')).toHaveLength(3);
      // The dead holder's late release changes nothing.
      expect(await service.release(dead[0], 'completed')).toBe(false);
      expect(w.slots().find((s) => s['id'] === dead[0].id)!['outcome']).toBe('expired');
    });

    it('a slot is still held just before its lease ends', async () => {
      const w = world();
      const { service } = w.instance();
      for (let i = 0; i < 3; i += 1) await service.admit(USER.alice, 'upload');
      w.advance(30 * MINUTE - 1);
      expect(body(await rejection(service.admit(USER.alice, 'upload'))).code).toBe('UPLOAD_TOO_MANY_ACTIVE');
    });

    it('uses the database clock: a skewed process clock changes nothing', async () => {
      const w = world();
      const { service } = w.instance();
      const spy = jest.spyOn(Date, 'now').mockReturnValue(new Date('2099-01-01T00:00:00Z').getTime());
      try {
        for (let i = 0; i < 3; i += 1) await service.admit(USER.alice, 'upload');
        expect(body(await rejection(service.admit(USER.alice, 'upload'))).code).toBe('UPLOAD_TOO_MANY_ACTIVE');
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('housekeeping', () => {
    it('expires dead leases and deletes finished rows older than a week, keeping recent ones', async () => {
      const w = world();
      const { service } = w.instance();
      const old = await service.admit(USER.alice, 'upload');
      await service.release(old, 'completed');
      w.advance(8 * 24 * 60 * MINUTE);
      const recent = await service.admit(USER.bob, 'upload');
      await service.release(recent, 'completed');
      const dead = await service.admit(USER.alice, 'upload');
      w.advance(31 * MINUTE);

      const result = await service.housekeeping();
      expect(result).toEqual({ expired: 1, deleted: 1 });
      const ids = w.slots().map((s) => s['id']);
      expect(ids).not.toContain(old.id);
      expect(ids).toEqual(expect.arrayContaining([recent.id, dead.id]));
      expect(w.slots().find((s) => s['id'] === dead.id)!['outcome']).toBe('expired');
    });

    it('does nothing when another instance is already doing it', async () => {
      const w = world();
      const a = w.instance();
      const b = w.instance();
      await a.service.admit(USER.alice, 'upload');
      w.advance(31 * MINUTE);
      const result = await a.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${CENTRAL_HOUSEKEEPING_LOCK_KEY}) AS locked`;
        return b.service.housekeeping();
      });
      expect(result).toEqual({ expired: 0, deleted: 0 });
      expect(w.slots()[0]['released_at']).toBeNull();
    });

    it('swallows a database failure (the worker must not crash)', async () => {
      const w = world();
      const { prisma, service } = w.instance();
      prisma.$transaction = () => Promise.reject(new Error('db down'));
      await expect(service.housekeeping()).resolves.toEqual({ expired: 0, deleted: 0 });
    });
  });
});
