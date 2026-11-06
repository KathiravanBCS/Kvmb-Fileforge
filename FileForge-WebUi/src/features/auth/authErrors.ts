const GENERIC_MESSAGE = 'We could not complete sign-in. Please try again.';

// Codes the API appends as `/?auth_error=<code>` when sign-in fails. They are coarse by design: the API never
// puts details in the URL. Messages come from this table only; the query value itself is never rendered.
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Sign-in was cancelled. You can try again when you are ready.',
  consent_required: 'FileForge needs your permission to continue. Please try again and approve the requested access.',
  session_expired: 'Your sign-in took too long or was interrupted. Please try again.',
  login_failed: GENERIC_MESSAGE,
  account_unavailable: 'This Microsoft account cannot be used with FileForge right now. Please contact your administrator.',
  service_unavailable: 'FileForge is temporarily unavailable. Please try again in a few minutes.',
};

/** A user-facing message for an `auth_error` code, or null when there was no sign-in error. */
export function getAuthErrorMessage(code: string | null): string | null {
  if (code === null) return null;
  // hasOwn: a crafted value such as "constructor" must not resolve to an inherited property.
  return (Object.hasOwn(AUTH_ERROR_MESSAGES, code) ? AUTH_ERROR_MESSAGES[code] : undefined) ?? GENERIC_MESSAGE;
}
