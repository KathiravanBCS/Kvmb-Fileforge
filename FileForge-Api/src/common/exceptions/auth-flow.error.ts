import type { OAuthPurpose } from '../types/session.types';

/**
 * Coarse, user-facing failure codes. They are sent to the browser in the redirect URL
 * (`?auth_error=<code>` or `?onedrive_error=<code>`), so they must never reveal internals.
 */
export type AuthFailureCode =
  | 'access_denied'
  | 'consent_required'
  | 'session_expired'
  | 'login_failed'
  | 'account_unavailable'
  | 'service_unavailable'
  // Connect OneDrive only:
  | 'account_mismatch'
  | 'workspace_forbidden'
  | 'onedrive_unavailable'
  // Connect central storage only:
  | 'central_storage_forbidden'
  | 'central_storage_unavailable';

/** A failed Microsoft redirect. `reason` is a short internal slug that is safe to log; it is never sent to the browser. */
export class AuthFlowError extends Error {
  readonly purpose: OAuthPurpose;

  constructor(
    readonly code: AuthFailureCode,
    readonly reason: string,
    options?: { cause?: unknown; purpose?: OAuthPurpose },
  ) {
    super(`${code}:${reason}`, options);
    this.name = 'AuthFlowError';
    this.purpose = options?.purpose ?? 'login';
  }

  /** The same failure, tagged with the flow it happened in (decides where the browser is sent back to). */
  withPurpose(purpose: OAuthPurpose): AuthFlowError {
    return new AuthFlowError(this.code, this.reason, { cause: this.cause, purpose });
  }
}
