import type { PrismaService } from '../../prisma/prisma.service';
import { WorkspacesService } from './workspaces.service';

function setup(data: { members: object[]; workspaces: object[]; roles: object[] }) {
  const prisma = {
    workspace_members: { findMany: jest.fn().mockResolvedValue(data.members) },
    workspaces: { findMany: jest.fn().mockResolvedValue(data.workspaces) },
    roles: { findMany: jest.fn().mockResolvedValue(data.roles) },
  };
  return { prisma, service: new WorkspacesService(prisma as unknown as PrismaService) };
}

describe('WorkspacesService.listForUser', () => {
  it('lists the user’s active workspaces with their role, as decimal-string ids', async () => {
    const { service, prisma } = setup({
      members: [
        { workspace_id: 1n, role_id: 10n },
        { workspace_id: 2n, role_id: 11n },
      ],
      workspaces: [
        { id: 1n, name: 'Personal', workspace_type: 'personal' },
        { id: 2n, name: 'Team', workspace_type: 'team' },
      ],
      roles: [
        { id: 10n, code: 'owner' },
        { id: 11n, code: 'viewer' },
      ],
    });

    await expect(service.listForUser('7')).resolves.toEqual([
      { id: '1', name: 'Personal', type: 'personal', role: 'owner' },
      { id: '2', name: 'Team', type: 'team', role: 'viewer' },
    ]);
    expect(prisma.workspace_members.findMany).toHaveBeenCalledWith({
      where: { user_id: 7n, membership_status: 'active', is_deleted: false },
      orderBy: { id: 'asc' },
    });
  });

  it('only asks for active, non-deleted workspaces and roles', async () => {
    const { service, prisma } = setup({ members: [{ workspace_id: 1n, role_id: 10n }], workspaces: [], roles: [] });
    await service.listForUser('7');
    expect(prisma.workspaces.findMany).toHaveBeenCalledWith({
      where: { id: { in: [1n] }, is_active: true, is_deleted: false },
    });
    expect(prisma.roles.findMany).toHaveBeenCalledWith({ where: { id: { in: [10n] }, is_deleted: false } });
  });

  it('drops memberships whose workspace or role is gone or inactive (fails closed)', async () => {
    const { service } = setup({
      members: [
        { workspace_id: 1n, role_id: 10n },
        { workspace_id: 2n, role_id: 10n },
        { workspace_id: 3n, role_id: 99n },
      ],
      workspaces: [
        { id: 1n, name: 'Ok', workspace_type: 'personal' },
        { id: 3n, name: 'NoRole', workspace_type: 'team' },
      ],
      roles: [{ id: 10n, code: 'owner' }],
    });
    await expect(service.listForUser('7')).resolves.toEqual([{ id: '1', name: 'Ok', type: 'personal', role: 'owner' }]);
  });

  it('returns nothing, without further queries, for a user with no memberships', async () => {
    const { service, prisma } = setup({ members: [], workspaces: [], roles: [] });
    await expect(service.listForUser('7')).resolves.toEqual([]);
    expect(prisma.workspaces.findMany).not.toHaveBeenCalled();
  });
});
