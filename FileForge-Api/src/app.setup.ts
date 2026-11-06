import type { ConfigType } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { setupSwagger } from './app.swagger';
import { API_PREFIX } from './common/constants/api.constants';
import { CSRF_HEADER } from './common/constants/auth.constants';
import { createSessionMiddleware } from './common/middleware/session.middleware';
import { SessionStoreService } from './common/session/session-store.service';
import appConfig from './config/app.config';
import authConfig from './config/auth.config';

/** HTTP-level setup shared by main.ts and the integration tests. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  const auth = app.get<ConfigType<typeof authConfig>>(authConfig.KEY);

  app.disable('x-powered-by');
  // Every route, including the Swagger UI, is served under /api/v1.
  app.setGlobalPrefix(API_PREFIX);
  // Required for Secure cookies when a reverse proxy terminates TLS; off by default so the header cannot be spoofed.
  if (config.trustProxy) app.set('trust proxy', 1);

  app.enableCors({
    // One explicit origin. Credentialed CORS must never use a wildcard.
    origin: config.cors.origin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', CSRF_HEADER],
    // Lets the browser read the retry time of a 429.
    exposedHeaders: ['Retry-After'],
  });

  app.use(
    createSessionMiddleware({
      secret: auth.session.secret,
      cookieName: auth.session.cookieName,
      ttlMs: auth.session.ttlMs,
      secureCookies: auth.session.secureCookies,
      store: app.get(SessionStoreService).store,
    }),
  );

  // API documentation is for development; it is not served in production.
  if (!config.isProduction) setupSwagger(app, auth.session.cookieName);

  app.enableShutdownHooks();
}
