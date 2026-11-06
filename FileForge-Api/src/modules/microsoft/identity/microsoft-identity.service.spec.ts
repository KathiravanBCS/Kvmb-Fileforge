import {
  AuthError,
  ConfidentialClientApplication,
  InteractionRequiredAuthError,
  type AuthenticationResult,
} from '@azure/msal-node';

import authConfig from '../../../config/auth.config';
import { TEST_ENV } from '../../../testing/test-env';
import { MicrosoftApiError } from '../microsoft.errors';
import { MicrosoftIdentityService, PERSONAL_ACCOUNT_TENANT_ID } from './microsoft-identity.service';

jest.mock('@azure/msal-node', () => ({
  ...jest.requireActual<typeof import('@azure/msal-node')>('@azure/msal-node'),
  ConfidentialClientApplication: jest.fn(),
}));

const MockedClient = ConfidentialClientApplication as unknown as jest.Mock;
const ORG_TENANT = '11111111-2222-3333-4444-555555555555';
const NONCE = 'expected-nonce';

interface CapturedConfig {
  cache?: {
    cachePlugin: { beforeCacheAccess: (c: unknown) => Promise<void>; afterCacheAccess: (c: unknown) => Promise<void> };
  };
}

function useMsalClient(client: Record<string, unknown>) {
  const captured: { config?: CapturedConfig } = {};
  MockedClient.mockImplementation((config: CapturedConfig) => {
    captured.config = config;
    return client;
  });
  return captured;
}

function idTokenClaims(overrides: Record<string, unknown> = {}) {
  return {
    aud: TEST_ENV.MICROSOFT_CLIENT_ID,
    iss: `https://login.microsoftonline.com/${ORG_TENANT}/v2.0`,
    tid: ORG_TENANT,
    oid: 'oid-123',
    sub: 'sub-456',
    nonce: NONCE,
    exp: Math.floor(Date.now() / 1000) + 3600,
    preferred_username: 'ada@example.com',
    name: 'Ada Lovelace',
    ...overrides,
  };
}

function msalResult(claims: Record<string, unknown>): AuthenticationResult {
  return {
    idTokenClaims: claims,
    account: { homeAccountId: 'home-1' },
    accessToken: 'at',
  } as unknown as AuthenticationResult;
}

const redeem = (service: MicrosoftIdentityService) =>
  service.redeemAuthorizationCode({ code: 'auth-code', codeVerifier: 'verifier', nonce: NONCE });

describe('MicrosoftIdentityService', () => {
  let service: MicrosoftIdentityService;

  beforeEach(() => {
    MockedClient.mockReset();
    service = new MicrosoftIdentityService(authConfig());
  });

  describe('createAuthorizationRequest', () => {
    it('builds an authorization-code request with state, nonce and a PKCE S256 challenge', async () => {
      const getAuthCodeUrl = jest
        .fn()
        .mockResolvedValue('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1');
      useMsalClient({ getAuthCodeUrl });

      const request = await service.createAuthorizationRequest();

      const sent = getAuthCodeUrl.mock.calls[0][0] as Record<string, unknown>;
      expect(sent['redirectUri']).toBe(TEST_ENV.MICROSOFT_REDIRECT_URI);
      expect(sent['codeChallengeMethod']).toBe('S256');
      expect(sent['codeChallenge']).toEqual(expect.any(String));
      expect(sent['state']).toBe(request.state);
      expect(sent['nonce']).toBe(request.nonce);
      expect(sent['prompt']).toBe('select_account');
      expect(sent['scopes']).toEqual(['openid', 'profile', 'email', 'offline_access', 'User.Read']);
      // The verifier stays server-side; only its hash goes to Microsoft.
      expect(request.codeVerifier).not.toBe(sent['codeChallenge']);
      expect(request.url).not.toContain(request.codeVerifier);
    });

    it('never puts the client secret in the URL it asks for, and uses fresh values every time', async () => {
      useMsalClient({ getAuthCodeUrl: jest.fn().mockResolvedValue('https://login.microsoftonline.com/authorize') });
      const first = await service.createAuthorizationRequest();
      const second = await service.createAuthorizationRequest();

      expect(first.state).not.toBe(second.state);
      expect(first.nonce).not.toBe(second.nonce);
      expect(first.codeVerifier).not.toBe(second.codeVerifier);
      expect(first.state).not.toBe(first.nonce);
      expect(MockedClient.mock.calls[0][0].auth.clientSecret).toBe(TEST_ENV.MICROSOFT_CLIENT_SECRET);
      expect(first.url).not.toContain(TEST_ENV.MICROSOFT_CLIENT_SECRET);
    });
  });

  describe('redeemAuthorizationCode', () => {
    it('exchanges the code with the PKCE verifier and nonce, then returns a verified identity', async () => {
      const acquireTokenByCode = jest.fn().mockResolvedValue(msalResult(idTokenClaims()));
      useMsalClient({ acquireTokenByCode });

      const { identity } = await redeem(service);

      expect(acquireTokenByCode).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'auth-code', codeVerifier: 'verifier', nonce: NONCE }),
      );
      expect(identity).toEqual({
        provider: 'microsoft',
        issuer: `https://login.microsoftonline.com/${ORG_TENANT}/v2.0`,
        subject: 'oid-123',
        providerUserId: 'sub-456',
        tenantId: ORG_TENANT,
        accountType: 'organizational',
        homeAccountId: 'home-1',
        email: 'ada@example.com',
        displayName: 'Ada Lovelace',
        loginHint: 'ada@example.com',
      });
    });

    it('recognizes personal Microsoft accounts by their fixed tenant id, with a different issuer', async () => {
      useMsalClient({
        acquireTokenByCode: jest.fn().mockResolvedValue(
          msalResult(
            idTokenClaims({
              tid: PERSONAL_ACCOUNT_TENANT_ID,
              iss: `https://login.microsoftonline.com/${PERSONAL_ACCOUNT_TENANT_ID}/v2.0`,
            }),
          ),
        ),
      });
      const { identity } = await redeem(service);
      expect(identity.accountType).toBe('personal');
      expect(identity.issuer).toContain(PERSONAL_ACCOUNT_TENANT_ID);
    });

    it('prefers the email claim, and returns null (not a guess) when there is no usable email', async () => {
      useMsalClient({
        acquireTokenByCode: jest
          .fn()
          .mockResolvedValueOnce(
            msalResult(idTokenClaims({ email: 'real@example.com', preferred_username: 'alias@example.com' })),
          )
          .mockResolvedValueOnce(msalResult(idTokenClaims({ preferred_username: 'not-an-email', name: undefined }))),
      });
      expect((await redeem(service)).identity.email).toBe('real@example.com');
      const second = (await redeem(service)).identity;
      expect(second.email).toBeNull();
      expect(second.displayName).toBeNull();
    });

    it('returns the serialized token cache produced by MSAL so it can be kept server-side', async () => {
      const captured = useMsalClient({
        acquireTokenByCode: jest.fn().mockImplementation(async () => {
          await captured.config?.cache?.cachePlugin.afterCacheAccess({
            cacheHasChanged: true,
            tokenCache: { serialize: () => '{"serialized":"cache"}' },
          });
          return msalResult(idTokenClaims());
        }),
      });
      expect((await redeem(service)).tokenCache).toBe('{"serialized":"cache"}');
    });

    it.each([
      ['an ID token issued to a different application (aud)', { aud: 'some-other-client' }, 'audience_mismatch'],
      [
        'an issuer that does not match the token tenant (iss)',
        { iss: 'https://evil.example.com/tid/v2.0' },
        'issuer_mismatch',
      ],
      ['a v1.0 issuer', { iss: `https://sts.windows.net/${ORG_TENANT}/` }, 'issuer_mismatch'],
      ['a nonce that was not issued for this login', { nonce: 'attacker-nonce' }, 'nonce_mismatch'],
      ['a missing nonce', { nonce: undefined }, 'nonce_mismatch'],
      ['an expired ID token', { exp: Math.floor(Date.now() / 1000) - 3600 }, 'id_token_expired'],
      ['a missing oid claim', { oid: undefined }, 'identity_claims_missing'],
      ['a missing tenant claim', { tid: undefined }, 'identity_claims_missing'],
    ])('rejects %s', async (_label, claims, reason) => {
      useMsalClient({ acquireTokenByCode: jest.fn().mockResolvedValue(msalResult(idTokenClaims(claims))) });
      await expect(redeem(service)).rejects.toMatchObject({ name: 'AuthFlowError', code: 'login_failed', reason });
    });

    it.each([
      [
        'a rejected or replayed code',
        new AuthError('invalid_grant', 'corr-1', 'AADSTS70008'),
        'login_failed',
        'code_rejected',
      ],
      [
        'a nonce mismatch detected by MSAL',
        new AuthError('nonce_mismatch', 'corr-1'),
        'login_failed',
        'nonce_mismatch',
      ],
      [
        'missing consent',
        new InteractionRequiredAuthError('consent_required', 'corr-1'),
        'consent_required',
        'consent_required',
      ],
      ['an unknown exchange failure', new Error('socket hang up'), 'login_failed', 'token_exchange_failed'],
    ])('maps %s to a safe failure', async (_label, thrown, code, reason) => {
      useMsalClient({ acquireTokenByCode: jest.fn().mockRejectedValue(thrown) });
      await expect(redeem(service)).rejects.toMatchObject({ name: 'AuthFlowError', code, reason });
    });
  });

  describe('acquireTokenSilent', () => {
    const cache = { load: () => undefined, save: () => undefined };
    const params = { cache, homeAccountId: 'home-1', scopes: ['User.Read'] };

    it('returns a renewed access token for the cached account', async () => {
      const acquireTokenSilent = jest.fn().mockResolvedValue({ accessToken: 'tok', expiresOn: new Date(0) });
      useMsalClient({
        getTokenCache: () => ({ getAccountByHomeId: jest.fn().mockResolvedValue({ homeAccountId: 'home-1' }) }),
        acquireTokenSilent,
      });
      await expect(service.acquireTokenSilent({ ...params, forceRefresh: true })).resolves.toEqual({
        accessToken: 'tok',
        expiresOn: new Date(0),
      });
      expect(acquireTokenSilent).toHaveBeenCalledWith(
        expect.objectContaining({ scopes: ['User.Read'], forceRefresh: true }),
      );
    });

    it('asks for re-authentication when the account is not in the cache (e.g. after a restart)', async () => {
      useMsalClient({ getTokenCache: () => ({ getAccountByHomeId: jest.fn().mockResolvedValue(null) }) });
      await expect(service.acquireTokenSilent(params)).rejects.toMatchObject({ kind: 'reauth_required' });
    });

    it.each([
      ['consent_required', 'consent_required'],
      ['invalid_grant', 'reauth_required'],
    ])('maps interaction-required "%s" to %s', async (errorCode, kind) => {
      useMsalClient({
        getTokenCache: () => ({ getAccountByHomeId: jest.fn().mockResolvedValue({ homeAccountId: 'home-1' }) }),
        acquireTokenSilent: jest.fn().mockRejectedValue(new InteractionRequiredAuthError(errorCode, 'corr-1')),
      });
      const error = await service.acquireTokenSilent(params).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MicrosoftApiError);
      expect(error).toMatchObject({ kind });
    });
  });
});
