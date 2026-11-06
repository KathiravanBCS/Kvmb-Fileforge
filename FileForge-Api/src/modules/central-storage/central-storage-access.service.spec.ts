import type { ExecutionContext } from '@nestjs/common';

import type { PrismaService } from '../../prisma/prisma.service';
import { centralWorld, USER } from '../../testing/central-fixtures';
import { CentralStorageAccessService } from './central-storage-access.service';
import { SystemAdminGuard } from './guards/system-admin.guard';

const sessionUser = (id: bigint) => ({ id: id.toString(), email: `u${id}@example.com`, displayName: null });

function setup() {
  const world = centralWorld();
  const access = new CentralStorageAccessService(world.prisma as unknown as PrismaService);
  const admins = world.tables['system_admins'];
  const users = world.tables['users'];
  return { ...world, access, admins, users, guard: new SystemAdminGuard(access) };
}

const outcome = async (promise: Promise<unknown>) => {
  try {
    return { ok: true as const, value: await promise };
  } catch (error) {
    const e = error as { getStatus?: () => number; response?: { code?: string } };
    return { ok: false as const, status: e.getStatus?.(), code: e.response?.code };
  }
};

const contextFor = (user: ReturnType<typeof sessionUser> | undefined) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ session: user ? { user } : {} }) }) }) as unknown as ExecutionContext;

describe('who is a system administrator', () => {
  it('only a live grant in core.system_admins makes someone an administrator', async () => {
    const { access } = setup();
    expect(await access.isSystemAdmin(USER.admin)).toBe(true);
    expect(await access.isSystemAdmin(USER.alice)).toBe(false);
    expect(await access.isSystemAdmin(USER.bob)).toBe(false);
  });

  it('does NOT consult workspaces or roles: owning a (personal) workspace never makes anybody an administrator', async () => {
    // The fake database has no workspace / workspace_members / roles tables registered: reading any of them throws.
    // Alice and Bob are workspace OWNERS in real life, and must still be ordinary users.
    const { access } = setup();
    await expect(access.isSystemAdmin(USER.alice)).resolves.toBe(false);
    await expect(access.requireSystemAdmin(USER.alice)).rejects.toMatchObject({
      response: { code: 'SYSTEM_ADMIN_REQUIRED' },
    });
  });

  it('a revoked (is_active = false) grant stops being valid immediately', async () => {
    const { access, admins } = setup();
    expect(await access.isSystemAdmin(USER.admin)).toBe(true);
    (admins.rows[0] as Record<string, unknown>)['is_active'] = false;
    expect(await access.isSystemAdmin(USER.admin)).toBe(false);
  });

  it('a soft-deleted grant is not valid', async () => {
    const { access, admins } = setup();
    Object.assign(admins.rows[0] as object, { is_deleted: true, deleted_at: new Date() });
    expect(await access.isSystemAdmin(USER.admin)).toBe(false);
  });

  it('a deactivated or deleted administrator account is not an administrator', async () => {
    const { access, users } = setup();
    const row = users.rows.find((r) => r['id'] === USER.admin) as Record<string, unknown>;
    row['is_active'] = false;
    expect(await access.isSystemAdmin(USER.admin)).toBe(false);
    row['is_active'] = true;
    Object.assign(row, { is_deleted: true, deleted_at: new Date() });
    expect(await access.isSystemAdmin(USER.admin)).toBe(false);
  });

  it('a grant for a user id that has no account row is worthless', async () => {
    const { access, admins } = setup();
    admins.seed({ user_id: 999n });
    expect(await access.isSystemAdmin(999n)).toBe(false);
  });
});

describe('actors', () => {
  it('the ordinary actor is never an administrator, even for the administrator user', async () => {
    const { access } = setup();
    expect(await access.userActor(sessionUser(USER.admin), { requestId: 'r1', ip: '::1' })).toEqual({
      userId: USER.admin,
      isAdmin: false,
      requestId: 'r1',
      ip: '::1',
    });
  });

  it('refuses a deactivated user an actor at all', async () => {
    const { access } = setup();
    expect(await outcome(access.userActor(sessionUser(USER.inactive)))).toMatchObject({
      ok: false,
      status: 403,
      code: 'ACCOUNT_UNAVAILABLE',
    });
    expect(await outcome(access.userActor(sessionUser(12345n)))).toMatchObject({ ok: false, status: 403 });
  });

  it('only a granted administrator can get an administrator actor, and never by claiming it', async () => {
    const { access } = setup();
    expect(await access.adminActor(sessionUser(USER.admin))).toMatchObject({ userId: USER.admin, isAdmin: true });
    expect(await outcome(access.adminActor(sessionUser(USER.alice)))).toMatchObject({
      ok: false,
      status: 403,
      code: 'SYSTEM_ADMIN_REQUIRED',
    });
  });

  it('only active users can be the target of an upload on their behalf', async () => {
    const { access } = setup();
    await expect(access.requireEligibleOwner(USER.bob)).resolves.toBeUndefined();
    expect(await outcome(access.requireEligibleOwner(USER.inactive))).toMatchObject({
      ok: false,
      status: 404,
      code: 'USER_NOT_FOUND',
    });
    expect(await outcome(access.requireEligibleOwner(777n))).toMatchObject({
      ok: false,
      status: 404,
      code: 'USER_NOT_FOUND',
    });
  });
});

describe('SystemAdminGuard (every /admin/central-storage route)', () => {
  it('lets a granted administrator through', async () => {
    const { guard } = setup();
    await expect(guard.canActivate(contextFor(sessionUser(USER.admin)))).resolves.toBe(true);
  });

  it.each([
    ['an ordinary user', USER.alice],
    ['a workspace owner without a grant', USER.bob],
    ['a deactivated user', USER.inactive],
    ['an unknown user', 4242n],
  ])('answers 403 for %s', async (_label, id) => {
    const { guard } = setup();
    expect(await outcome(guard.canActivate(contextFor(sessionUser(id))))).toMatchObject({
      ok: false,
      status: 403,
      code: 'SYSTEM_ADMIN_REQUIRED',
    });
  });

  it('answers 403 without a session user', async () => {
    const { guard } = setup();
    expect(await outcome(guard.canActivate(contextFor(undefined)))).toMatchObject({ ok: false, status: 403 });
  });

  it('revoking the administrator blocks the very next request (the database is asked every time)', async () => {
    const { guard, admins } = setup();
    await expect(guard.canActivate(contextFor(sessionUser(USER.admin)))).resolves.toBe(true);
    (admins.rows[0] as Record<string, unknown>)['is_active'] = false;
    expect(await outcome(guard.canActivate(contextFor(sessionUser(USER.admin))))).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('trusts nothing in the request except the server-side session user', async () => {
    const { guard } = setup();
    const forged = {
      switchToHttp: () => ({
        getRequest: () => ({
          session: { user: sessionUser(USER.alice) },
          headers: { 'x-admin': 'true', 'x-user-id': '1' },
          query: { isAdmin: 'true', userId: '1' },
          body: { isSystemAdmin: true },
        }),
      }),
    } as unknown as ExecutionContext;
    expect(await outcome(guard.canActivate(forged))).toMatchObject({ ok: false, status: 403 });
  });
});
