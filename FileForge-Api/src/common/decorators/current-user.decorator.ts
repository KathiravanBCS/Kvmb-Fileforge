import type { Request } from 'express';

import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';

import type { SessionUser } from '../types/session.types';

/** The signed-in user from the server-side session. Only usable on authenticated (non-@Public) routes. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): SessionUser => {
  const user = context.switchToHttp().getRequest<Request>().session?.user;
  if (!user) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Authentication required.' });
  return user;
});
