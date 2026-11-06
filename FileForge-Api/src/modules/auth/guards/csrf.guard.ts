import type { Request } from 'express';

import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { CSRF_HEADER } from '../../../common/constants/auth.constants';
import { safeEqual } from '../../../common/utils/security.util';
import appConfig from '../../../config/app.config';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global CSRF protection for cookie sessions (synchronizer-token pattern):
 * every state-changing request must carry the session's own random token in the X-CSRF-Token header,
 * obtained from GET /auth/csrf. A forged cross-site request has the cookie but cannot read or send the token.
 * If the browser sends an Origin header it must also be the configured frontend origin.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;

    const origin = request.headers.origin;
    if (origin !== undefined && origin !== this.config.frontendOrigin) {
      throw new ForbiddenException({ code: 'CSRF_ORIGIN_MISMATCH', message: 'Request origin is not allowed.' });
    }

    const expected = request.session?.csrfToken;
    const provided = request.get(CSRF_HEADER);
    if (!expected || !provided || !safeEqual(expected, provided)) {
      throw new ForbiddenException({ code: 'CSRF_TOKEN_INVALID', message: 'Missing or invalid CSRF token.' });
    }
    return true;
  }
}
