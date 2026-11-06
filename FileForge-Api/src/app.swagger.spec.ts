import request from 'supertest';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { TEST_ENV } from './testing/test-env';

async function createApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}

describe('API prefix and Swagger (development)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
  });
  const http = () => request(app.getHttpServer());

  it('serves everything under /api/v1', async () => {
    await http().get('/api/v1/health/live').expect(200);
    await http().get('/api/v1/auth/me').expect(401);
  });

  it.each(['/health/live', '/auth/me', '/auth/csrf', '/docs'])(
    'no longer answers on the old unprefixed path %s',
    async (path) => {
      const res = await http().get(path).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    },
  );

  it('serves the Swagger UI at /api/v1/docs without needing a session', async () => {
    const res = await http().get('/api/v1/docs').redirects(1).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toMatch(/swagger/i);
  });

  describe('OpenAPI document (/api/v1/docs-json)', () => {
    let doc: {
      paths: Record<string, Record<string, { parameters?: { name: string; in: string; required?: boolean }[] }>>;
      components: {
        securitySchemes: Record<string, unknown>;
        schemas: Record<string, { properties: Record<string, object> }>;
      };
    };
    beforeAll(async () => {
      doc = (await http().get('/api/v1/docs-json').expect(200)).body;
    });

    it('documents every endpoint with its real, prefixed path', () => {
      expect(Object.keys(doc.paths).sort()).toEqual([
        '/api/v1/admin/central-storage/connection',
        '/api/v1/admin/central-storage/connection/connect',
        '/api/v1/admin/central-storage/connection/verify',
        '/api/v1/admin/central-storage/files',
        '/api/v1/admin/central-storage/files/{id}',
        '/api/v1/admin/central-storage/files/{id}/content',
        '/api/v1/admin/central-storage/files/{id}/download',
        '/api/v1/admin/central-storage/files/{id}/preview',
        '/api/v1/admin/central-storage/files/{id}/resync',
        '/api/v1/admin/central-storage/recovery/items',
        '/api/v1/admin/central-storage/recovery/items/{id}',
        '/api/v1/admin/central-storage/recovery/items/{id}/dismiss',
        '/api/v1/admin/central-storage/recovery/items/{id}/retry',
        '/api/v1/admin/central-storage/recovery/summary',
        '/api/v1/admin/central-storage/usage',
        '/api/v1/admin/central-storage/users',
        '/api/v1/admin/central-storage/users/{userId}/files',
        '/api/v1/admin/central-storage/users/{userId}/files/upload',
        '/api/v1/auth/csrf',
        '/api/v1/auth/logout',
        '/api/v1/auth/me',
        '/api/v1/auth/microsoft/callback',
        '/api/v1/auth/microsoft/login',
        '/api/v1/central-storage/capabilities',
        '/api/v1/central-storage/files',
        '/api/v1/central-storage/files/upload',
        '/api/v1/central-storage/files/{id}',
        '/api/v1/central-storage/files/{id}/content',
        '/api/v1/central-storage/files/{id}/download',
        '/api/v1/central-storage/files/{id}/preview',
        '/api/v1/central-storage/usage',
        '/api/v1/health/live',
        '/api/v1/workspaces',
        '/api/v1/workspaces/{workspaceId}/storage/onedrive',
        '/api/v1/workspaces/{workspaceId}/storage/onedrive/connect',
        '/api/v1/workspaces/{workspaceId}/storage/onedrive/files',
        '/api/v1/workspaces/{workspaceId}/storage/onedrive/files/content',
        '/api/v1/workspaces/{workspaceId}/storage/onedrive/items',
      ]);
    });

    it('documents the file operations with their methods', () => {
      const files = doc.paths['/api/v1/workspaces/{workspaceId}/storage/onedrive/files'] ?? {};
      expect(Object.keys(files).sort()).toEqual(['delete', 'patch', 'post']);
    });

    it('describes the session cookie scheme under the configured cookie name', () => {
      expect(doc.components.securitySchemes['session']).toEqual({
        type: 'apiKey',
        in: 'cookie',
        name: 'fileforge.sid',
      });
    });

    it('documents the CSRF header on logout and the exact /auth/me shape', () => {
      const header = doc.paths['/api/v1/auth/logout']?.['post']?.parameters?.find((p) => p.name === 'X-CSRF-Token');
      expect(header).toMatchObject({ in: 'header', required: true });
      expect(Object.keys(doc.components.schemas['AuthUserResponseDto']?.properties ?? {})).toEqual([
        'id',
        'displayName',
        'email',
      ]);
    });

    it('contains no secrets or configuration values', () => {
      const text = JSON.stringify(doc);
      for (const secret of [TEST_ENV.MICROSOFT_CLIENT_SECRET, TEST_ENV.SESSION_SECRET, TEST_ENV.DATABASE_URL]) {
        expect(text).not.toContain(secret);
      }
    });
  });
});

describe('Swagger in production', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    // Production refuses to start on the in-memory session store. The store's pool is lazy: nothing connects here.
    process.env['NODE_ENV'] = 'production';
    process.env['SESSION_STORE'] = 'postgres';
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    process.env['NODE_ENV'] = TEST_ENV.NODE_ENV;
    delete process.env['SESSION_STORE'];
  });

  it('is not served, but the API itself is', async () => {
    await request(app.getHttpServer()).get('/api/v1/docs').expect(404);
    await request(app.getHttpServer()).get('/api/v1/docs-json').expect(404);
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
  });
});
