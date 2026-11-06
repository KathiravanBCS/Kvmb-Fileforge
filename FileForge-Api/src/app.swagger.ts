import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { CSRF_HEADER } from './common/constants/auth.constants';

export const SESSION_SECURITY_SCHEME = 'session';

/** Swagger UI at /api/v1/docs (JSON at /api/v1/docs-json). Same origin as the API, so the session cookie is sent. */
export function setupSwagger(app: NestExpressApplication, sessionCookieName: string): void {
  const config = new DocumentBuilder()
    .setTitle('FileForge API')
    .setVersion('1.0')
    .setDescription(
      [
        'Backend for FileForge AI. Authentication is a server-side session cookie created by Microsoft sign-in.',
        '',
        '**To call protected endpoints here:** sign in once through the React app (http://localhost:3000). The',
        'session cookie is shared with this page, so GET endpoints such as `/auth/me` then work with *Try it out*.',
        '',
        `**State-changing requests** need the \`${CSRF_HEADER}\` header (value from \`GET /auth/csrf\`) and must come from the`,
        'frontend origin. Swagger UI runs on the API origin, so the CSRF origin check rejects its POSTs',
        '(for example `/auth/logout`) on purpose; use the React app for those.',
      ].join('\n'),
    )
    .addCookieAuth(
      sessionCookieName,
      { type: 'apiKey', in: 'cookie', name: sessionCookieName },
      SESSION_SECURITY_SCHEME,
    )
    .build();

  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config), {
    // Serve at <global prefix>/docs, i.e. /api/v1/docs.
    useGlobalPrefix: true,
    swaggerOptions: { persistAuthorization: false },
  });
}
