import 'express-session';

/** The signed-in FileForge user as kept in the server-side session. `id` is a BIGINT as a decimal string. */
export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
}

/** What a started Microsoft redirect is for. Decided by the server when it starts the flow, never by the browser. */
export type OAuthPurpose = 'login' | 'connect_onedrive' | 'connect_central_storage';

/** A started (not yet completed) Microsoft redirect. Single use, short lived. */
export interface OAuthTransaction {
  codeVerifier: string;
  nonce: string;
  createdAt: number;
  /** Missing on transactions written before purposes existed: treated as `login`. */
  purpose?: OAuthPurpose;
  /** Only for `connect_onedrive`: the workspace the connection is for (BIGINT as a decimal string). */
  workspaceId?: string;
}

/** The Microsoft account the user signed in with: later Microsoft flows must come back as this same account. */
export interface SessionIdentity {
  issuer: string;
  subject: string;
}

declare module 'express-session' {
  interface SessionData {
    user?: SessionUser;
    identity?: SessionIdentity;
    csrfToken?: string;
    /** Pending redirects keyed by the OAuth `state` value. */
    oauth?: Record<string, OAuthTransaction>;
    /** Serialized MSAL token cache (holds Microsoft tokens). Server-side only, never sent to the browser. */
    msalCache?: string;
    homeAccountId?: string;
  }
}
