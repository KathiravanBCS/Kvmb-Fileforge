import {
  AuthError,
  ConfidentialClientApplication,
  CryptoProvider,
  InteractionRequiredAuthError,
  LogLevel,
  type AuthenticationResult,
} from '@azure/msal-node';

import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { MICROSOFT_PROVIDER } from '../../../common/constants/auth.constants';
import { AuthFlowError } from '../../../common/exceptions/auth-flow.error';
import { randomToken } from '../../../common/utils/security.util';
import authConfig from '../../../config/auth.config';
import { MicrosoftApiError } from '../microsoft.errors';
import type { AuthorizationRequest, TokenCacheStore, VerifiedMicrosoftIdentity } from './microsoft-identity.types';

/** Microsoft's fixed tenant id for consumer (personal) Microsoft accounts. */
export const PERSONAL_ACCOUNT_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';

const CLOCK_SKEW_SECONDS = 60;
const MAX_DISPLAY_NAME_LENGTH = 200;

/**
 * Microsoft Entra ID sign-in (OpenID Connect authorization code flow + PKCE, confidential client)
 * and delegated token renewal, on top of @azure/msal-node.
 *
 * MSAL does not verify the ID token signature: it trusts the TLS channel to the token endpoint, which
 * OpenID Connect Core 3.1.3.7 allows for the code flow. The claims are still checked explicitly below.
 */
@Injectable()
export class MicrosoftIdentityService {
  private readonly cryptoProvider = new CryptoProvider();

  constructor(@Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>) {}

  /**
   * Step 1-3 of the flow: fresh state, nonce and PKCE pair, and the Microsoft authorize URL.
   * Defaults to the sign-in scopes with the account picker. For incremental consent pass the extra `scopes` and the
   * signed-in user's `loginHint`, and no `prompt`: Microsoft then only shows a screen for permissions not yet granted.
   */
  async createAuthorizationRequest(
    options: { scopes?: string[]; loginHint?: string; prompt?: 'select_account' | 'none' } = {},
  ): Promise<AuthorizationRequest> {
    const { verifier, challenge } = await this.cryptoProvider.generatePkceCodes();
    const state = randomToken();
    const nonce = randomToken();
    const { redirectUri, loginScopes } = this.config.microsoft;
    const incremental = options.scopes !== undefined;

    const url = await this.createClient().getAuthCodeUrl({
      scopes: options.scopes ?? loginScopes,
      redirectUri,
      state,
      nonce,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      loginHint: options.loginHint,
      // Lets people with several Microsoft accounts (personal and work) pick the right one at sign-in.
      prompt: options.prompt ?? (incremental ? undefined : 'select_account'),
    });
    return { url, state, nonce, codeVerifier: verifier };
  }

  /**
   * Step 6-7: exchange the authorization code and verify the resulting identity.
   * Without `cache`, returns the serialized MSAL cache (it holds the refresh token) for the caller to keep server-side.
   * With `cache`, tokens are written into that store instead (and `tokenCache` is undefined).
   */
  async redeemAuthorizationCode(params: {
    code: string;
    codeVerifier: string;
    nonce: string;
    scopes?: string[];
    cache?: TokenCacheStore;
  }): Promise<{ identity: VerifiedMicrosoftIdentity; tokenCache: string | undefined; scopes: string[] }> {
    let snapshot: string | undefined;
    const local: TokenCacheStore = {
      load: () => snapshot,
      save: (serialized) => {
        snapshot = serialized;
      },
    };

    let result: AuthenticationResult;
    try {
      result = await this.createClient(params.cache ?? local).acquireTokenByCode({
        code: params.code,
        codeVerifier: params.codeVerifier,
        // MSAL itself rejects an ID token whose nonce differs.
        nonce: params.nonce,
        scopes: params.scopes ?? this.config.microsoft.loginScopes,
        redirectUri: this.config.microsoft.redirectUri,
      });
    } catch (error) {
      throw this.mapExchangeError(error);
    }

    return {
      identity: this.verifyIdentity(result, params.nonce),
      tokenCache: params.cache ? undefined : snapshot,
      scopes: result.scopes ?? [],
    };
  }

  /**
   * Delegated access token for Microsoft Graph, renewed from the cached refresh token when needed.
   * Never log the returned token.
   */
  async acquireTokenSilent(params: {
    cache: TokenCacheStore;
    homeAccountId: string;
    scopes: string[];
    forceRefresh?: boolean;
  }): Promise<{ accessToken: string; expiresOn: Date | null }> {
    const client = this.createClient(params.cache);
    try {
      const account = await client.getTokenCache().getAccountByHomeId(params.homeAccountId);
      if (!account) throw new MicrosoftApiError('reauth_required');

      const result = await client.acquireTokenSilent({
        account,
        scopes: params.scopes,
        forceRefresh: params.forceRefresh,
      });
      if (!result?.accessToken) throw new MicrosoftApiError('reauth_required');
      return { accessToken: result.accessToken, expiresOn: result.expiresOn };
    } catch (error) {
      if (error instanceof MicrosoftApiError) throw error;
      if (error instanceof InteractionRequiredAuthError) {
        // A scope that was never consented comes back as `invalid_grant` with sub-error `consent_required`
        // (AADSTS65001), not as errorCode `consent_required`: all three signals must be checked.
        const needsConsent =
          error.errorCode === 'consent_required' ||
          error.subError === 'consent_required' ||
          (error.errorMessage ?? '').includes('AADSTS65001');
        throw new MicrosoftApiError(needsConsent ? 'consent_required' : 'reauth_required', { cause: error });
      }
      throw new MicrosoftApiError('unavailable', { cause: error });
    }
  }

  /** One short-lived MSAL client per operation, bound to the caller's own (per-session) token cache. */
  private createClient(cache?: TokenCacheStore): ConfidentialClientApplication {
    const { clientId, clientSecret, authority } = this.config.microsoft;
    return new ConfidentialClientApplication({
      auth: { clientId, clientSecret, authority },
      cache: cache && {
        cachePlugin: {
          // MSAL's plugin interface is promise-based; the session-backed store itself is synchronous.
          beforeCacheAccess: (context) => {
            const serialized = cache.load();
            if (serialized) context.tokenCache.deserialize(serialized);
            return Promise.resolve();
          },
          afterCacheAccess: (context) => {
            if (context.cacheHasChanged) cache.save(context.tokenCache.serialize());
            return Promise.resolve();
          },
        },
      },
      // MSAL logging stays off: its messages can include request details.
      system: {
        loggerOptions: { loggerCallback: () => undefined, piiLoggingEnabled: false, logLevel: LogLevel.Error },
      },
    });
  }

  private verifyIdentity(result: AuthenticationResult, expectedNonce: string): VerifiedMicrosoftIdentity {
    const claims = result.idTokenClaims as Record<string, unknown>;
    const text = (name: string): string | null => {
      const value = claims[name];
      return typeof value === 'string' && value ? value : null;
    };

    const tenantId = text('tid');
    const subject = text('oid');
    const providerUserId = text('sub');
    if (!tenantId || !subject || !providerUserId) throw new AuthFlowError('login_failed', 'identity_claims_missing');

    // aud: the token must have been issued to this application.
    if (claims['aud'] !== this.config.microsoft.clientId) throw new AuthFlowError('login_failed', 'audience_mismatch');

    // iss: the tenant-specific v2.0 issuer on the configured authority host (the `common` authority
    // signs in users from any tenant, so the issuer is checked against the token's own tenant id).
    const expectedIssuer = `${new URL(this.config.microsoft.authority).origin}/${tenantId}/v2.0`;
    if (claims['iss'] !== expectedIssuer) throw new AuthFlowError('login_failed', 'issuer_mismatch');

    if (claims['nonce'] !== expectedNonce) throw new AuthFlowError('login_failed', 'nonce_mismatch');

    const exp = claims['exp'];
    if (typeof exp !== 'number' || exp + CLOCK_SKEW_SECONDS < Date.now() / 1000) {
      throw new AuthFlowError('login_failed', 'id_token_expired');
    }

    const preferredUsername = text('preferred_username');
    const emailClaim = text('email') ?? (preferredUsername?.includes('@') ? preferredUsername : null);
    const name = text('name')?.trim().slice(0, MAX_DISPLAY_NAME_LENGTH) || null;

    return {
      provider: MICROSOFT_PROVIDER,
      issuer: expectedIssuer,
      subject,
      providerUserId,
      tenantId,
      accountType: tenantId === PERSONAL_ACCOUNT_TENANT_ID ? 'personal' : 'organizational',
      homeAccountId: result.account?.homeAccountId ?? null,
      email: emailClaim,
      displayName: name,
      loginHint: preferredUsername,
    };
  }

  private mapExchangeError(error: unknown): AuthFlowError {
    if (error instanceof AuthFlowError) return error;
    const code = error instanceof AuthError ? error.errorCode : undefined;
    if (code === 'nonce_mismatch') return new AuthFlowError('login_failed', 'nonce_mismatch', { cause: error });
    if (code === 'consent_required' || code === 'interaction_required') {
      return new AuthFlowError('consent_required', code, { cause: error });
    }
    // invalid_grant covers an expired, already-used or tampered authorization code.
    if (code === 'invalid_grant') return new AuthFlowError('login_failed', 'code_rejected', { cause: error });
    return new AuthFlowError('login_failed', 'token_exchange_failed', { cause: error });
  }
}
