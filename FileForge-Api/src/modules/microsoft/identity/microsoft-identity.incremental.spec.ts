import { ConfidentialClientApplication, InteractionRequiredAuthError } from '@azure/msal-node';

import authConfig from '../../../config/auth.config';
import { TEST_ENV } from '../../../testing/test-env';
import { MicrosoftIdentityService } from './microsoft-identity.service';

jest.mock('@azure/msal-node', () => ({
  ...jest.requireActual<typeof import('@azure/msal-node')>('@azure/msal-node'),
  ConfidentialClientApplication: jest.fn(),
}));

const MockedClient = ConfidentialClientApplication as unknown as jest.Mock;
const TENANT = '11111111-2222-3333-4444-555555555555';
const NONCE = 'expected-nonce';

function claims() {
  return {
    aud: TEST_ENV.MICROSOFT_CLIENT_ID,
    iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
    tid: TENANT,
    oid: 'oid-1',
    sub: 'sub-1',
    nonce: NONCE,
    exp: Math.floor(Date.now() / 1000) + 3600,
    preferred_username: 'ada@example.com',
  };
}

describe('MicrosoftIdentityService: incremental consent', () => {
  let service: MicrosoftIdentityService;
  beforeEach(() => {
    MockedClient.mockReset();
    service = new MicrosoftIdentityService(authConfig());
  });

  describe('createAuthorizationRequest', () => {
    it('asks for the extra scopes for the signed-in account, with no account picker', async () => {
      const getAuthCodeUrl = jest.fn().mockResolvedValue('https://login.microsoftonline.com/authorize');
      MockedClient.mockImplementation(() => ({ getAuthCodeUrl }));

      await service.createAuthorizationRequest({
        scopes: ['openid', 'offline_access', 'Files.ReadWrite'],
        loginHint: 'ada@example.com',
      });

      const sent = getAuthCodeUrl.mock.calls[0][0] as Record<string, unknown>;
      expect(sent['scopes']).toEqual(['openid', 'offline_access', 'Files.ReadWrite']);
      expect(sent['loginHint']).toBe('ada@example.com');
      expect(sent['prompt']).toBeUndefined(); // Microsoft only shows a screen for permissions not yet granted
      expect(sent['codeChallengeMethod']).toBe('S256');
      expect(sent['state']).toEqual(expect.any(String));
      expect(sent['nonce']).toEqual(expect.any(String));
    });

    it('keeps the account picker for a plain sign-in', async () => {
      const getAuthCodeUrl = jest.fn().mockResolvedValue('https://login.microsoftonline.com/authorize');
      MockedClient.mockImplementation(() => ({ getAuthCodeUrl }));
      await service.createAuthorizationRequest();
      const sent = getAuthCodeUrl.mock.calls[0][0] as Record<string, unknown>;
      expect(sent['prompt']).toBe('select_account');
      expect(sent['scopes']).toEqual(['openid', 'profile', 'email', 'offline_access', 'User.Read']);
      expect(sent['loginHint']).toBeUndefined();
    });
  });

  describe('redeemAuthorizationCode with a supplied cache', () => {
    it('writes tokens into that cache (not a private one) and returns the granted scopes', async () => {
      let cachePlugin: { afterCacheAccess: (c: unknown) => Promise<void> } | undefined;
      MockedClient.mockImplementation((config: { cache?: { cachePlugin: typeof cachePlugin } }) => {
        cachePlugin = config.cache?.cachePlugin;
        return {
          acquireTokenByCode: jest.fn().mockImplementation(async () => {
            await cachePlugin?.afterCacheAccess({
              cacheHasChanged: true,
              tokenCache: { serialize: () => 'MERGED-CACHE' },
            });
            return {
              idTokenClaims: claims(),
              account: { homeAccountId: 'h' },
              scopes: ['Files.ReadWrite', 'User.Read'],
              accessToken: 'at',
            };
          }),
        };
      });
      const saved: string[] = [];
      const cache = { load: () => 'EXISTING', save: (s: string) => void saved.push(s) };

      const result = await service.redeemAuthorizationCode({
        code: 'c',
        codeVerifier: 'v',
        nonce: NONCE,
        scopes: ['Files.ReadWrite'],
        cache,
      });

      expect(saved).toEqual(['MERGED-CACHE']);
      expect(result.tokenCache).toBeUndefined();
      expect(result.scopes).toEqual(['Files.ReadWrite', 'User.Read']);
      expect(result.identity.subject).toBe('oid-1');
    });

    it('requests the scopes it is given for the exchange', async () => {
      const acquireTokenByCode = jest
        .fn()
        .mockResolvedValue({ idTokenClaims: claims(), account: null, scopes: [], accessToken: 'at' });
      MockedClient.mockImplementation(() => ({ acquireTokenByCode }));
      await service.redeemAuthorizationCode({
        code: 'c',
        codeVerifier: 'v',
        nonce: NONCE,
        scopes: ['Files.ReadWrite'],
      });
      expect(acquireTokenByCode).toHaveBeenCalledWith(
        expect.objectContaining({ scopes: ['Files.ReadWrite'], nonce: NONCE }),
      );
    });
  });

  describe('a scope that was never consented (the state right after sign-in, before Connect OneDrive)', () => {
    const silentFailing = (error: unknown) => {
      MockedClient.mockImplementation(() => ({
        getTokenCache: () => ({ getAccountByHomeId: jest.fn().mockResolvedValue({ homeAccountId: 'h' }) }),
        acquireTokenSilent: jest.fn().mockRejectedValue(error),
      }));
      return service.acquireTokenSilent({
        cache: { load: () => undefined, save: () => undefined },
        homeAccountId: 'h',
        scopes: ['Files.ReadWrite'],
      });
    };

    it.each([
      ['errorCode consent_required', new InteractionRequiredAuthError('consent_required', 'c')],
      // What Microsoft actually returns for AADSTS65001: invalid_grant with sub-error consent_required.
      [
        'invalid_grant with sub-error consent_required',
        // No AADSTS text here on purpose: each of the three signals must be sufficient on its own.
        new InteractionRequiredAuthError(
          'invalid_grant',
          'c',
          'The grant requires more permissions',
          'consent_required',
        ),
      ],
      [
        'an AADSTS65001 message alone',
        new InteractionRequiredAuthError(
          'invalid_grant',
          'c',
          'AADSTS65001: The user or administrator has not consented to use the application',
        ),
      ],
    ])('is reported as consent_required (%s)', async (_label, error) => {
      await expect(silentFailing(error)).rejects.toMatchObject({ kind: 'consent_required' });
    });

    it.each([
      [
        'an expired or revoked refresh token',
        new InteractionRequiredAuthError(
          'invalid_grant',
          'c',
          'AADSTS700082: The refresh token has expired',
          'bad_token',
        ),
      ],
      ['login required', new InteractionRequiredAuthError('login_required', 'c')],
    ])('is NOT mistaken for missing consent when it is %s', async (_label, error) => {
      await expect(silentFailing(error)).rejects.toMatchObject({ kind: 'reauth_required' });
    });
  });
});
