import type { Request } from 'express';

import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

import type { WorkspaceMembership } from './workspaces.service';

export const WORKSPACE_ROLES_KEY = 'workspaceRoles';

/** Restrict a route (that has a `:workspaceId` param and WorkspaceAccessGuard) to these role codes. */
export const WorkspaceRoles = (...roleCodes: string[]) => SetMetadata(WORKSPACE_ROLES_KEY, roleCodes);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      workspaceContext?: WorkspaceMembership;
    }
  }
}

/** The caller's validated membership of the workspace in the route. Set by WorkspaceAccessGuard. */
export const WorkspaceContext = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  return context.switchToHttp().getRequest<Request>().workspaceContext;
});
