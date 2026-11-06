import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { CentralStorageAccessService } from './central-storage-access.service';
import { CentralStorageService } from './central-storage.service';
import type { Actor, CentralUsage } from './types/central-storage.types';

export interface AdminUserUsage {
  id: string;
  email: string;
  displayName: string | null;
  fileCount: number;
  totalBytes: number;
}

export interface AdminUsage {
  total: CentralUsage;
  perUser: AdminUserUsage[];
}

const MAX_USERS = 200;

/** Cross-user views for system administrators. Every method rechecks the administrator grant in the database. */
@Injectable()
export class CentralStorageAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: CentralStorageService,
    private readonly access: CentralStorageAccessService,
  ) {}

  /** Active users (to pick an upload target / filter by) with their usage, including users with no files yet. */
  async listUsers(actor: Actor, search?: string): Promise<AdminUserUsage[]> {
    await this.access.requireSystemAdmin(actor.userId);
    const users = await this.prisma.users.findMany({
      where: {
        is_deleted: false,
        is_active: true,
        ...(search
          ? {
              OR: [
                { email: { contains: search, mode: 'insensitive' } },
                { display_name: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { email: 'asc' },
      take: MAX_USERS,
      select: { id: true, email: true, display_name: true },
    });
    const usage = new Map((await this.files.usageByUser(actor)).map((entry) => [entry.ownerId, entry]));
    return users.map((user) => ({
      id: user.id.toString(),
      email: user.email,
      displayName: user.display_name,
      fileCount: usage.get(user.id)?.fileCount ?? 0,
      totalBytes: usage.get(user.id)?.totalBytes ?? 0,
    }));
  }

  /** Total usage and the usage of every user that has files. */
  async usage(actor: Actor): Promise<AdminUsage> {
    await this.access.requireSystemAdmin(actor.userId);
    const [total, perOwner] = await Promise.all([this.files.usage(actor), this.files.usageByUser(actor)]);
    const users = await this.prisma.users.findMany({
      where: { id: { in: perOwner.map((entry) => entry.ownerId) } },
      select: { id: true, email: true, display_name: true },
    });
    const byId = new Map(users.map((user) => [user.id, user]));
    return {
      total,
      perUser: perOwner
        .map((entry) => ({
          id: entry.ownerId.toString(),
          email: byId.get(entry.ownerId)?.email ?? '',
          displayName: byId.get(entry.ownerId)?.display_name ?? null,
          fileCount: entry.fileCount,
          totalBytes: entry.totalBytes,
        }))
        .sort((a, b) => b.totalBytes - a.totalBytes),
    };
  }
}
