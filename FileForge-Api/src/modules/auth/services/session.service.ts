import type { Request, Response } from 'express';

import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import type { SessionIdentity, SessionUser } from '../../../common/types/session.types';
import { randomToken } from '../../../common/utils/security.util';
import authConfig from '../../../config/auth.config';

/** express-session uses Node-style callbacks (error typed `any`); this turns them into awaitable calls. */
function awaitCallback(register: (done: (error?: unknown) => void) => void): Promise<void> {
  return new Promise<void>((resolve, reject) =>
    register((error) =>
      error ? reject(error instanceof Error ? error : new Error('Session store error')) : resolve(),
    ),
  );
}

@Injectable()
export class SessionService {
  constructor(@Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>) {}

  /**
   * Replaces any existing session with a brand-new one for this user (new id, so a session id planted
   * before login is useless), with a fresh CSRF token and the server-side Microsoft token cache.
   */
  async establish(
    request: Request,
    params: {
      user: SessionUser;
      identity: SessionIdentity;
      tokenCache?: string;
      homeAccountId?: string | null;
    },
  ): Promise<void> {
    await awaitCallback((done) => request.session.regenerate(done));

    const session = request.session;
    session.user = params.user;
    // Later Microsoft flows (Connect OneDrive) must come back as this same account.
    session.identity = params.identity;
    session.csrfToken = randomToken();
    session.msalCache = params.tokenCache;
    session.homeAccountId = params.homeAccountId ?? undefined;

    // Persist before the redirect, so the browser never arrives with a cookie that has no session behind it.
    await awaitCallback((done) => session.save(done));
  }

  /** Destroys the server-side session (and with it the Microsoft tokens) and clears the cookie. */
  async destroy(request: Request, response: Response): Promise<void> {
    await awaitCallback((done) => request.session.destroy(done));
    response.clearCookie(this.config.session.cookieName, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.session.secureCookies,
      path: '/',
    });
  }
}
