import type { Request } from 'express';

import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { WORKSPACE_ROLES_KEY } from './workspace-access';
import { WorkspacesService } from './workspaces.service';

// Largest BIGINT (2^63 - 1) as digits; anything longer cannot be a valid id.
const BIGINT_MAX = 9223372036854775807n;

/**
 * Workspace-scoped authorization for routes shaped like `/workspaces/:workspaceId/...`.
 * Use after authentication (the global guard), with @WorkspaceRoles(...) to require specific role codes.
 * The membership always comes from the database, never from anything the client claims.
 */
@Injectable()
export class WorkspaceAccessGuard implements CanActivate {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.session?.user;
    const raw = request.params['workspaceId'];

    if (!user) throw new ForbiddenException({ code: 'WORKSPACE_ACCESS_DENIED', message: 'Access denied.' });
    if (typeof raw !== 'string' || !/^\d{1,19}$/.test(raw) || BigInt(raw) > BIGINT_MAX) {
      throw new BadRequestException({ code: 'INVALID_WORKSPACE_ID', message: 'Invalid workspace id.' });
    }

    const membership = await this.workspaces.findActiveMembership(user.id, raw);
    // Same answer for "no such workspace" and "not a member": do not reveal which workspaces exist.
    if (!membership) throw new ForbiddenException({ code: 'WORKSPACE_ACCESS_DENIED', message: 'Access denied.' });

    const allowedRoles = this.reflector.getAllAndOverride<string[] | undefined>(WORKSPACE_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowedRoles?.length && !allowedRoles.includes(membership.roleCode)) {
      throw new ForbiddenException({ code: 'WORKSPACE_ROLE_FORBIDDEN', message: 'Your role cannot do this.' });
    }

    request.workspaceContext = membership;
    return true;
  }
}
