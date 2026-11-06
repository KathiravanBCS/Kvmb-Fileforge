/**
 * What the Microsoft redirect tells the browser after "Connect central OneDrive": `?central=connected` on success or
 * `?central_error=<code>` on failure (codes set by FileForge-Api's callback). Anything unknown is shown generically.
 */
export interface CentralNotice {
  kind: 'success' | 'error';
  message: string;
}

const ERRORS: Record<string, string> = {
  access_denied: 'The connection was cancelled, so nothing was changed.',
  consent_required:
    'Microsoft did not grant the permission FileForge needs (access to OneDrive files). Connect again and accept it.',
  session_expired: 'Your sign-in expired while connecting. Sign in again and retry.',
  account_mismatch:
    'That is not the Microsoft account you are signed in with, or the central storage is already connected to a different account. Nothing was changed.',
  central_storage_forbidden: 'Only system administrators can connect the central storage.',
  central_storage_unavailable: 'OneDrive could not be set up right now. Try again in a moment.',
  login_failed: 'Microsoft sign-in did not complete. Try again.',
};

export function getCentralNotice(params: URLSearchParams): CentralNotice | null {
  if (params.get('central') === 'connected') {
    return { kind: 'success', message: 'Central OneDrive connected. Use “Check connection” to confirm it works.' };
  }
  const code = params.get('central_error');
  if (code) return { kind: 'error', message: ERRORS[code] ?? 'Connecting the central OneDrive did not complete.' };
  return null;
}

/** Friendly text for the connection states the API reports. */
export const CONNECTION_STATUS_TEXT: Record<string, { label: string; color: string; hint: string }> = {
  connected: { label: 'Connected', color: 'green', hint: 'Users can upload and open their files.' },
  not_connected: {
    label: 'Not connected',
    color: 'gray',
    hint: 'Connect the administrator’s OneDrive before anyone can upload files.',
  },
  unverified: { label: 'Not verified yet', color: 'yellow', hint: 'Run “Check connection” to confirm it works.' },
  reauth_required: {
    label: 'Reconnect required',
    color: 'red',
    hint: 'Microsoft access expired or was revoked. Reconnect to restore uploads and downloads.',
  },
  revoked: { label: 'Access revoked', color: 'red', hint: 'Access was revoked in Microsoft. Reconnect to restore it.' },
  error: {
    label: 'Needs attention',
    color: 'red',
    hint: 'The stored connection could not be used. Reconnect the same Microsoft account to repair it.',
  },
};
