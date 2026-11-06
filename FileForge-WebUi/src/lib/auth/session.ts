// The API client reports "your session ended" here without knowing who is listening. AuthProvider registers the
// handler and moves the app to its signed-out state, which shows the existing sign-in screen (no redirect, so no loop).

/** Code of a 401 that means the session is gone. Other 401s (e.g. MICROSOFT_REAUTH_REQUIRED) are not a sign-out. */
export const SESSION_ENDED_CODE = 'UNAUTHENTICATED';

type Handler = () => void;

let handler: Handler | null = null;

export function setSessionEndedHandler(next: Handler | null): void {
  handler = next;
}

export function notifySessionEnded(): void {
  handler?.();
}
