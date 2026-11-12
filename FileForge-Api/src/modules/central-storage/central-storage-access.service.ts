import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import type { SessionUser } from '../../common/types/session.types';
import { PrismaService } from '../../prisma/prisma.service';
import type { Actor } from './types/central-storage.types';

export interface RequestMeta {
  requestId?: string;
  ip?: string;
}

/**
 * Who may do what in central storage. The ONLY place that builds an Actor, and the only place that decides administrator
 * status: from system_admins in PostgreSQL, on every request. Never from the session, a header, a role claim, the
 * frontend, or workspace ownership (every user owns their personal workspace; that makes nobody a system administrator).
 */
@Injectable()
export class CentralStorageAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** A live administrator grant AND an active, not deleted user. Anything else is "not an administrator". */
  async isSystemAdmin(userId: bigint): Promise<boolean> {
    const grant = await this.prisma.system_admins.findFirst({
      where: { user_id: userId, is_active: true, is_deleted: false },
      select: { id: true },
    });
    return grant !== null && (await this.isActiveUser(userId));
  }

  async requireSystemAdmin(userId: bigint): Promise<void> {
    if (!(await this.isSystemAdmin(userId))) {
      throw new ForbiddenException({
        code: 'SYSTEM_ADMIN_REQUIRED',
        message: 'You do not have permission to do this.',
      });
    }
  }

  /** The actor for /central-storage routes: always an ordinary user, even if that user is also an administrator. */
  async userActor(user: SessionUser, meta: RequestMeta = {}): Promise<Actor> {
    const userId = BigInt(user.id);
    if (!(await this.isActiveUser(userId))) {
      throw new ForbiddenException({ code: 'ACCOUNT_UNAVAILABLE', message: 'Your account cannot use file storage.' });
    }
    return { userId, isAdmin: false, ...meta };
  }

  /** The actor for /admin/central-storage routes. Throws unless the database grants administrator access right now. */
  async adminActor(user: SessionUser, meta: RequestMeta = {}): Promise<Actor> {
    const userId = BigInt(user.id);
    await this.requireSystemAdmin(userId);
    return { userId, isAdmin: true, ...meta };
  }

  /** Files can only be uploaded for an existing, active user. */
  async requireEligibleOwner(userId: bigint): Promise<void> {
    if (!(await this.isActiveUser(userId))) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
  }

  private async isActiveUser(userId: bigint): Promise<boolean> {
    const user = await this.prisma.users.findFirst({
      where: { id: userId, is_active: true, is_deleted: false },
      select: { id: true },
    });
    return user !== null;
  }
}
