import request from 'supertest';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { AuthFlowError } from '../../common/exceptions/auth-flow.error';
import { randomToken } from '../../common/utils/security.util';
import { TEST_ENV } from '../../testing/test-env';
import { MicrosoftIdentityService } from '../microsoft/identity/microsoft-identity.service';
import type { VerifiedMicrosoftIdentity } from '../microsoft/identity/microsoft-identity.types';
import { UserProvisioningService } from '../users/user-provisioning.service';

const FRONTEND = TEST_ENV.FRONTEND_URL;
const MICROSOFT_TOKEN_CACHE = 'SERIALIZED-MSAL-CACHE-WITH-REFRESH-TOKEN';

const verifiedIdentity: VerifiedMicrosoftIdentity = {
  provider: 'microsoft',
  issuer: 'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0',
  subject: 'oid-1',
  providerUserId: 'sub-1',
  tenantId: '9188040d-6c67-4c5b-b112-36a304b66dad',
  accountType: 'personal',
  homeAccountId: 'home-1',
  email: 'person@example.com',
  displayName: null,
  loginHint: 'person@example.com',
};

const identityService = { createAuthorizationRequest: jest.fn(), redeemAuthorizationCode: jest.fn() };
const provisioning = { resolveOrProvision: jest.fn() };

let app: NestExpressApplication;

beforeEach(async () => {
  identityService.createAuthorizationRequest.mockImplementation(async () => {
    const state = randomToken();
    return {
      url: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x&state=${state}`,
      state,
      nonce: `nonce-${state}`,
      codeVerifier: `verifier-${state}`,
    };
  });
  identityService.redeemAuthorizationCode.mockResolvedValue({
    identity: verifiedIdentity,
    tokenCache: MICROSOFT_TOKEN_CACHE,
  });
  provisioning.resolveOrProvision.mockResolvedValue({ id: 123n, email: 'person@example.com', displayName: null });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MicrosoftIdentityService)
    .useValue(identityService)
    .overrideProvider(UserProvisioningService)
    .useValue(provisioning)
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
});

afterEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  await app.close();
});

const http = () => request(app.getHttpServer());
const cookieOf = (res: request.Response) =>
  (res.headers['set-cookie'] as unknown as string[] | undefined)?.[0]?.split(';')[0];

async function startLogin(agent: ReturnType<typeof request.agent>) {
  const res = await agent.get('/api/v1/auth/microsoft/login').expect(302);
  const location = new URL(res.headers['location']);
  return { res, location, state: location.searchParams.get('state') as string };
}

async function signIn(agent: ReturnType<typeof request.agent>) {
  const login = await startLogin(agent);
  const callback = await agent.get(`/api/v1/auth/microsoft/callback?code=auth-code&state=${login.state}`).expect(302);
  return { login, callback };
}

describe('GET /auth/microsoft/login', () => {
  it('redirects the browser to Microsoft and starts a server-side session with a safe cookie', async () => {
    const { res, location } = await startLogin(request.agent(app.getHttpServer()));

    expect(location.origin).toBe('https://login.microsoftonline.com');
    expect(location.searchParams.get('state')).toBeTruthy();
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
    expect(cookie).toMatch(/^fileforge\.sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Secure/i); // plain http in local development
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('answers with a failure redirect, not an error page, when it cannot start', async () => {
    identityService.createAuthorizationRequest.mockRejectedValue(new Error('network down'));
    const res = await http().get('/api/v1/auth/microsoft/login').expect(302);
    expect(res.headers['location']).toBe(`${FRONTEND}/?auth_error=service_unavailable`);
  });
});

describe('GET /auth/microsoft/callback', () => {
  it('rejects a callback whose state was never issued (forged or expired), without redeeming the code', async () => {
    const res = await http().get(`/api/v1/auth/microsoft/callback?code=stolen&state=${randomToken()}`).expect(302);
    expect(res.headers['location']).toBe(`${FRONTEND}/?auth_error=session_expired`);
    expect(identityService.redeemAuthorizationCode).not.toHaveBeenCalled();
  });

  it('rejects a valid state presented without the browser session that started the login', async () => {
    const { state } = await startLogin(request.agent(app.getHttpServer()));
    const res = await http().get(`/api/v1/auth/microsoft/callback?code=x&state=${state}`).expect(302); // different browser, no cookie
    expect(res.headers['location']).toBe(`${FRONTEND}/?auth_error=session_expired`);
    expect(identityService.redeemAuthorizationCode).not.toHaveBeenCalled();
  });

  it.each([
    ['access_denied', 'access_denied'],
    ['consent_required', 'consent_required'],
    ['server_error', 'login_failed'],
  ])('maps Microsoft error "%s" to the safe code "%s"', async (microsoftError, expected) => {
    const agent = request.agent(app.getHttpServer());
    const { state } = await startLogin(agent);
    const res = await agent
      .get(
        `/api/v1/auth/microsoft/callback?error=${microsoftError}&error_description=AADSTS65004%20secret%20details&state=${state}`,
      )
      .expect(302);

    expect(res.headers['location']).toBe(`${FRONTEND}/?auth_error=${expected}`);
    expect(res.headers['location']).not.toContain('AADSTS');
    expect(identityService.redeemAuthorizationCode).not.toHaveBeenCalled();
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('rejects malformed or repeated parameters', async () => {
    const agent = request.agent(app.getHttpServer());
    const { state } = await startLogin(agent);
    const res = await agent.get(`/api/v1/auth/microsoft/callback?code=a&code=b&state=${state}`).expect(302);
    expect(res.headers['location']).toBe(`${FRONTEND}/?auth_error=login_failed`);
  });

  it('creates a session, rotates the session id and sends the browser to the frontend', async () => {
    const agent = request.agent(app.getHttpServer());
    const { login, callback } = await signIn(agent);

    expect(callback.headers['location']).toBe(`${FRONTEND}/`);
    expect(identityService.redeemAuthorizationCode).toHaveBeenCalledWith({
      code: 'auth-code',
      codeVerifier: `verifier-${login.state}`,
      nonce: `nonce-${login.state}`,
    });
    // Session fixation defence: the id that existed before login is not the id after login.
    expect(cookieOf(callback)).toBeDefined();
    expect(cookieOf(callback)).not.toBe(cookieOf(login.res));
    await agent.get('/api/v1/auth/me').expect(200);
  });

  it('is single-use: replaying the same callback does not sign in again', async () => {
    const agent = request.agent(app.getHttpServer());
    const { login } = await signIn(agent);

    const replay = await request
      .agent(app.getHttpServer())
      .get(`/api/v1/auth/microsoft/callback?code=auth-code&state=${login.state}`)
      .expect(302);
    expect(replay.headers['location']).toBe(`${FRONTEND}/?auth_error=session_expired`);

    const replayOnSameBrowser = await agent
      .get(`/api/v1/auth/microsoft/callback?code=auth-code&state=${login.state}`)
      .expect(302);
    expect(replayOnSameBrowser.headers['location']).toBe(`${FRONTEND}/?auth_error=session_expired`);
    expect(identityService.redeemAuthorizationCode).toHaveBeenCalledTimes(1);
  });

  it('consumes the state even when the code exchange fails, and creates no session', async () => {
    identityService.redeemAuthorizationCode.mockRejectedValue(new AuthFlowError('login_failed', 'nonce_mismatch'));
    const agent = request.agent(app.getHttpServer());
    const { state } = await startLogin(agent);

    const res = await agent.get(`/api/v1/auth/microsoft/callback?code=x&state=${state}`).expect(302);
    expect(res.headers['location']).toBe(`${FRONTEND}/?auth_error=login_failed`);
    await agent.get('/api/v1/auth/me').expect(401);

    await agent.get(`/api/v1/auth/microsoft/callback?code=x&state=${state}`).expect(302); // retry with the same state
    expect(identityService.redeemAuthorizationCode).toHaveBeenCalledTimes(1);
  });

  it('never signs in when provisioning fails: unavailable database, refused account or anything unexpected', async () => {
    for (const [failure, expected] of [
      [new Error('ECONNREFUSED 10.0.0.1:5432 password=secret'), 'service_unavailable'],
      [new AuthFlowError('account_unavailable', 'email_in_use'), 'account_unavailable'],
      [new AuthFlowError('account_unavailable', 'owner_role_missing'), 'account_unavailable'],
    ] as const) {
      provisioning.resolveOrProvision.mockRejectedValueOnce(failure);
      const agent = request.agent(app.getHttpServer());
      const { state } = await startLogin(agent);
      const res = await agent.get(`/api/v1/auth/microsoft/callback?code=x&state=${state}`).expect(302);

      expect(res.headers['location']).toBe(`${FRONTEND}/?auth_error=${expected}`);
      expect(res.headers['location']).not.toMatch(/ECONNREFUSED|secret|10\.0\.0\.1/);
      await agent.get('/api/v1/auth/me').expect(401);
    }
  });

  it('expires a login that was not completed in time', async () => {
    const agent = request.agent(app.getHttpServer());
    const { state } = await startLogin(agent);
    const realNow = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(realNow + 11 * 60 * 1000);

    const res = await agent.get(`/api/v1/auth/microsoft/callback?code=x&state=${state}`).expect(302);
    expect(res.headers['location']).toBe(`${FRONTEND}/?auth_error=session_expired`);
    expect(identityService.redeemAuthorizationCode).not.toHaveBeenCalled();
  });
});

describe('GET /auth/me', () => {
  it('returns 401 with the standard error envelope when not signed in', async () => {
    const res = await http().get('/api/v1/auth/me').expect(401);
    expect(res.body).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required.', requestId: expect.any(String) },
    });
  });

  it('returns exactly id, displayName and email: BIGINT id as a string, nullable displayName', async () => {
    const agent = request.agent(app.getHttpServer());
    await signIn(agent);

    const res = await agent.get('/api/v1/auth/me').expect(200);

    expect(res.body).toEqual({ id: '123', displayName: null, email: 'person@example.com' });
    expect(typeof res.body.id).toBe('string');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('keeps a BIGINT above 2^53 exact, and returns a display name when there is one', async () => {
    provisioning.resolveOrProvision.mockResolvedValue({
      id: 9007199254740993n,
      email: 'a@example.com',
      displayName: 'Ada',
    });
    const agent = request.agent(app.getHttpServer());
    await signIn(agent);

    const res = await agent.get('/api/v1/auth/me').expect(200);
    expect(res.body).toEqual({ id: '9007199254740993', displayName: 'Ada', email: 'a@example.com' });
  });

  it('never exposes Microsoft tokens in any response body or cookie', async () => {
    const agent = request.agent(app.getHttpServer());
    const { login, callback } = await signIn(agent);
    const me = await agent.get('/api/v1/auth/me');
    const csrf = await agent.get('/api/v1/auth/csrf');

    for (const res of [login.res, callback, me, csrf]) {
      const everything = JSON.stringify([res.headers, res.body, res.text]);
      expect(everything).not.toContain(MICROSOFT_TOKEN_CACHE);
      expect(everything).not.toMatch(/access_token|refresh_token|id_token/i);
    }
  });

  it('stops working when the session lifetime has passed (enforced by the server, not the browser)', async () => {
    const agent = request.agent(app.getHttpServer());
    const { callback } = await signIn(agent);
    const cookie = cookieOf(callback) as string;

    await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);

    const realNow = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(realNow + 8 * 60 * 60 * 1000 + 1000); // SESSION_TTL_MINUTES=480, plus 1s
    await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
  });
});

describe('POST /auth/logout and CSRF protection', () => {
  const csrfOf = async (agent: ReturnType<typeof request.agent>) =>
    (await agent.get('/api/v1/auth/csrf').expect(200)).body.csrfToken as string;

  it('requires a signed-in session', async () => {
    await http().post('/api/v1/auth/logout').expect(401);
  });

  it('serves the CSRF token only to a signed-in session', async () => {
    await http().get('/api/v1/auth/csrf').expect(401);
    const agent = request.agent(app.getHttpServer());
    await signIn(agent);
    const token = await csrfOf(agent);
    expect(token).toHaveLength(43); // 256-bit base64url
    expect(await csrfOf(agent)).toBe(token); // stable for the session
  });

  it('rejects logout without a CSRF token, even with a valid session cookie', async () => {
    const agent = request.agent(app.getHttpServer());
    await signIn(agent);

    const res = await agent.post('/api/v1/auth/logout').expect(403);
    expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
    await agent.get('/api/v1/auth/me').expect(200); // still signed in
  });

  it('rejects a wrong or another session’s CSRF token', async () => {
    const mine = request.agent(app.getHttpServer());
    const other = request.agent(app.getHttpServer());
    await signIn(mine);
    await signIn(other);
    const othersToken = await csrfOf(other);

    await mine.post('/api/v1/auth/logout').set('X-CSRF-Token', 'x'.repeat(43)).expect(403);
    await mine.post('/api/v1/auth/logout').set('X-CSRF-Token', othersToken).expect(403);
    await mine.post('/api/v1/auth/logout').set('X-CSRF-Token', '').expect(403);
    await mine.get('/api/v1/auth/me').expect(200);
  });

  it('rejects a request from another origin even with the right token', async () => {
    const agent = request.agent(app.getHttpServer());
    await signIn(agent);
    const token = await csrfOf(agent);

    const res = await agent
      .post('/api/v1/auth/logout')
      .set('Origin', 'http://evil.example')
      .set('X-CSRF-Token', token)
      .expect(403);
    expect(res.body.error.code).toBe('CSRF_ORIGIN_MISMATCH');
  });

  it('with a valid token and origin: destroys the session, clears the cookie and answers 204', async () => {
    const agent = request.agent(app.getHttpServer());
    const { callback } = await signIn(agent);
    const oldCookie = cookieOf(callback) as string;
    const token = await csrfOf(agent);

    const res = await agent.post('/api/v1/auth/logout').set('Origin', FRONTEND).set('X-CSRF-Token', token).expect(204);

    const cleared = (res.headers['set-cookie'] as unknown as string[])[0];
    expect(cleared).toMatch(/^fileforge\.sid=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/i);
    expect(res.text).toBe('');
    await agent.get('/api/v1/auth/me').expect(401);
    // The old cookie is useless afterwards: the server-side session is gone, not merely hidden.
    await http().get('/api/v1/auth/me').set('Cookie', oldCookie).expect(401);
  });
});

describe('CORS', () => {
  it('allows only the configured frontend origin, with credentials', async () => {
    const res = await http()
      .options('/api/v1/auth/me')
      .set('Origin', FRONTEND)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'x-csrf-token')
      .expect(204);

    expect(res.headers['access-control-allow-origin']).toBe(FRONTEND);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-headers']).toMatch(/x-csrf-token/i);
  });

  it('never answers with a wildcard or reflects an untrusted origin', async () => {
    const res = await http()
      .options('/api/v1/auth/me')
      .set('Origin', 'http://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });
});

describe('public routes', () => {
  it('keeps the existing health endpoint reachable without a session', async () => {
    const res = await http().get('/api/v1/health/live').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('does not reveal framework details', async () => {
    const res = await http().get('/api/v1/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
