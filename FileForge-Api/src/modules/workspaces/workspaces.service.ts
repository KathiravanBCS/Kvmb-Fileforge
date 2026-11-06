import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

export interface WorkspaceSummary {
  /** BIGINT as a decimal string. */
  id: string;
  name: string;
  type: string;
  /** The caller's role code in this workspace. */
  role: string;
}

export interface WorkspaceMembership {
  /** BIGINT as a decimal string. */
  workspaceId: string;
  /** Role code from core.roles, resolved per workspace. There is no global role. */
  roleCode: string;
}

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The user's ACTIVE membership of an active workspace, or null. Fails closed: a missing, deleted or
   * suspended membership, workspace or role all mean "no access".
   */
  async findActiveMembership(userId: string, workspaceId: string): Promise<WorkspaceMembership | null> {
    const workspace = await this.prisma.workspaces.findFirst({
      where: { id: BigInt(workspaceId), is_active: true, is_deleted: false },
      select: { id: true },
    });
    if (!workspace) return null;

    const member = await this.prisma.workspace_members.findFirst({
      where: { workspace_id: workspace.id, user_id: BigInt(userId), membership_status: 'active', is_deleted: false },
    });
    if (!member) return null;

    const role = await this.prisma.roles.findFirst({ where: { id: member.role_id, is_deleted: false } });
    return role ? { workspaceId: workspace.id.toString(), roleCode: role.code } : null;
  }

  /** The workspaces the user is an ACTIVE member of, with their role in each. Never anyone else's. */
  async listForUser(userId: string): Promise<WorkspaceSummary[]> {
    const members = await this.prisma.workspace_members.findMany({
      where: { user_id: BigInt(userId), membership_status: 'active', is_deleted: false },
      orderBy: { id: 'asc' },
    });
    if (members.length === 0) return [];

    const [workspaces, roles] = await Promise.all([
      this.prisma.workspaces.findMany({
        where: { id: { in: members.map((m) => m.workspace_id) }, is_active: true, is_deleted: false },
      }),
      this.prisma.roles.findMany({ where: { id: { in: members.map((m) => m.role_id) }, is_deleted: false } }),
    ]);

    return members.flatMap((member) => {
      const workspace = workspaces.find((w) => w.id === member.workspace_id);
      const role = roles.find((r) => r.id === member.role_id);
      return workspace && role
        ? [{ id: workspace.id.toString(), name: workspace.name, type: workspace.workspace_type, role: role.code }]
        : [];
    });
  }
}
