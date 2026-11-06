import type { Request } from 'express';

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

import { CentralStorageAccessService } from '../central-storage-access.service';

/**
 * Guards every /admin/central-storage route. Runs after the global guards (signed-in session, CSRF), then asks the
 * DATABASE whether this user is currently a system administrator: revoking the grant blocks the very next request.
 */
@Injectable()
export class SystemAdminGuard implements CanActivate {
  constructor(private readonly access: CentralStorageAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<Request>().session?.user;
    if (!user)
      throw new ForbiddenException({
        code: 'SYSTEM_ADMIN_REQUIRED',
        message: 'You do not have permission to do this.',
      });
    await this.access.requireSystemAdmin(BigInt(user.id));
    return true;
  }
}
