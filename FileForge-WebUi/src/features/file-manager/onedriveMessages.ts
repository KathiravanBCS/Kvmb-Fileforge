const GENERIC_ERROR = 'We could not connect OneDrive. Please try again.';

// Codes the API appends as `/files?onedrive_error=<code>`. They are coarse by design: the API never puts details in the
// URL. Messages come from this table only; the query value itself is never rendered.
const ONEDRIVE_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Connecting OneDrive was cancelled. You can try again when you are ready.',
  consent_required: 'FileForge needs your permission to use OneDrive. Please try again and approve the access.',
  session_expired: 'Your session expired while connecting. Please sign in again and retry.',
  login_failed: GENERIC_ERROR,
  account_mismatch: 'That Microsoft account is not the one you are signed in with. Choose the same account and try again.',
  workspace_forbidden: 'Only a workspace owner or administrator can connect OneDrive.',
  onedrive_unavailable: 'OneDrive could not be set up right now. Please try again in a few minutes.',
  service_unavailable: 'FileForge is temporarily unavailable. Please try again in a few minutes.',
};

export type OneDriveNotice = { kind: 'success' | 'error'; message: string };

/** The notice for `?onedrive=connected` / `?onedrive_error=<code>` on the File Manager URL, or null. */
export function getOneDriveNotice(params: URLSearchParams): OneDriveNotice | null {
  if (params.get('onedrive') === 'connected') return { kind: 'success', message: 'OneDrive is connected.' };
  const code = params.get('onedrive_error');
  if (code === null) return null;
  // hasOwn: a crafted value such as "constructor" must not resolve to an inherited property.
  const message = Object.hasOwn(ONEDRIVE_ERROR_MESSAGES, code) ? ONEDRIVE_ERROR_MESSAGES[code] : undefined;
  return { kind: 'error', message: message ?? GENERIC_ERROR };
}
