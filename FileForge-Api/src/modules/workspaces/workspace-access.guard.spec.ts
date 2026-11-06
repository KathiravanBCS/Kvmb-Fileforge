import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { WorkspaceAccessGuard } from './workspace-access.guard';
import type { WorkspacesService } from './workspaces.service';

function setup(
  options: { allowedRoles?: string[]; membership?: { workspaceId: string; roleCode: string } | null } = {},
) {
  const findActiveMembership = jest.fn().mockResolvedValue(options.membership ?? null);
  const guard = new WorkspaceAccessGuard(
    { findActiveMembership } as unknown as WorkspacesService,
    { getAllAndOverride: jest.fn().mockReturnValue(options.allowedRoles) } as unknown as Reflector,
  );
  const run = (request: Record<string, unknown>) =>
    guard.canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext);
  return { run, findActiveMembership };
}

const signedIn = (workspaceId: string) => ({
  session: { user: { id: '5', email: 'a@example.com', displayName: null } },
  params: { workspaceId },
});

describe('WorkspaceAccessGuard', () => {
  it('lets an active member in and exposes the validated membership', async () => {
    const { run, findActiveMembership } = setup({ membership: { workspaceId: '10', roleCode: 'editor' } });
    const request = signedIn('10');

    await expect(run(request)).resolves.toBe(true);

    expect(findActiveMembership).toHaveBeenCalledWith('5', '10');
    expect((request as { workspaceContext?: unknown }).workspaceContext).toEqual({
      workspaceId: '10',
      roleCode: 'editor',
    });
  });

  it('answers 403 identically for "not a member" and "no such workspace"', async () => {
    const { run } = setup({ membership: null });
    await expect(run(signedIn('10'))).rejects.toMatchObject({
      status: 403,
      response: { code: 'WORKSPACE_ACCESS_DENIED' },
    });
  });

  it.each(['abc', '1.5', '-1', '', '9223372036854775808', '1'.repeat(25)])(
    'rejects the malformed workspace id "%s"',
    async (id) => {
      const { run, findActiveMembership } = setup({ membership: { workspaceId: '1', roleCode: 'owner' } });
      await expect(run(signedIn(id))).rejects.toMatchObject({
        status: 400,
        response: { code: 'INVALID_WORKSPACE_ID' },
      });
      expect(findActiveMembership).not.toHaveBeenCalled();
    },
  );

  it('accepts the largest BIGINT', async () => {
    const { run } = setup({ membership: { workspaceId: '9223372036854775807', roleCode: 'viewer' } });
    await expect(run(signedIn('9223372036854775807'))).resolves.toBe(true);
  });

  it('enforces workspace-scoped roles by role code', async () => {
    const owner = setup({ allowedRoles: ['owner', 'admin'], membership: { workspaceId: '10', roleCode: 'owner' } });
    await expect(owner.run(signedIn('10'))).resolves.toBe(true);

    const viewer = setup({ allowedRoles: ['owner', 'admin'], membership: { workspaceId: '10', roleCode: 'viewer' } });
    await expect(viewer.run(signedIn('10'))).rejects.toMatchObject({
      status: 403,
      response: { code: 'WORKSPACE_ROLE_FORBIDDEN' },
    });
  });

  it('grants nothing without a signed-in user', async () => {
    const { run, findActiveMembership } = setup({ membership: { workspaceId: '10', roleCode: 'owner' } });
    await expect(run({ params: { workspaceId: '10' } })).rejects.toMatchObject({ status: 403 });
    expect(findActiveMembership).not.toHaveBeenCalled();
  });
});
