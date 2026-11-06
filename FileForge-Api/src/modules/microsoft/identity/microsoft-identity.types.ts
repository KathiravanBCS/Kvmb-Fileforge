/** Where the (server-side) MSAL token cache is persisted. Implemented by the caller, e.g. over the session. */
export interface TokenCacheStore {
  load(): string | undefined;
  save(serialized: string): void;
}

export interface AuthorizationRequest {
  /** Where to send the browser. Contains state, nonce and the PKCE challenge, but never a secret. */
  url: string;
  state: string;
  nonce: string;
  /** Must stay on the server (in the pending-login record) until the code is redeemed. */
  codeVerifier: string;
}

/** An identity whose ID token passed issuer, audience, expiry and nonce checks. */
export interface VerifiedMicrosoftIdentity {
  provider: 'microsoft';
  /** The token's `iss`, e.g. https://login.microsoftonline.com/<tid>/v2.0 (tenant-specific). */
  issuer: string;
  /** The `oid` claim: stable for a user across app registrations (`sub` is per application). */
  subject: string;
  /** The `sub` claim. */
  providerUserId: string;
  tenantId: string;
  accountType: 'personal' | 'organizational';
  homeAccountId: string | null;
  /** Profile data only. Never use it to find or merge accounts. */
  email: string | null;
  displayName: string | null;
  loginHint: string | null;
}
