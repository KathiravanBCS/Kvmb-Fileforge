/**
 * What a caller can do about a failed Microsoft call:
 * - reauth_required:  the user must sign in again (no usable refresh token / token rejected)
 * - consent_required: the user must grant additional permissions
 * - forbidden:        signed in and consented, but not allowed to do this
 * - conflict:         the target already exists (HTTP 409, e.g. nameAlreadyExists)
 * - throttled:        retry later (see retryAfterSeconds)
 * - unavailable:      Microsoft is unreachable or failing
 */
export type MicrosoftErrorKind =
  | 'reauth_required'
  | 'consent_required'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'throttled'
  | 'unavailable'
  | 'unknown';

/** Safe to log and to map to an HTTP status: it never contains tokens or response bodies. */
export class MicrosoftApiError extends Error {
  constructor(
    readonly kind: MicrosoftErrorKind,
    options: { status?: number; graphCode?: string; retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(`Microsoft request failed: ${kind}`, { cause: options.cause });
    this.name = 'MicrosoftApiError';
    this.status = options.status;
    this.graphCode = options.graphCode;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  readonly status?: number;
  readonly graphCode?: string;
  readonly retryAfterSeconds?: number;
}
