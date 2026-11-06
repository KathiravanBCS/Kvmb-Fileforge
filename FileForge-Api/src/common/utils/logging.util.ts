/**
 * Log-safe description of an unknown error: only its class name and a short code.
 * Never `message` or `stack`: third-party errors can embed tokens, URLs or personal data.
 */
export function describeError(error: unknown): { name: string; code?: string } {
  if (error instanceof Error) {
    const code = (error as { code?: unknown; errorCode?: unknown }).errorCode ?? (error as { code?: unknown }).code;
    return { name: error.name, ...(typeof code === 'string' ? { code } : {}) };
  }
  return { name: typeof error };
}

/** Drops the query string: OAuth callback URLs carry `code` and `state`, which must never reach the logs. */
export function stripQuery(url: string | undefined): string {
  if (!url) return '';
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}

/**
 * What the HTTP request log may contain about a request: an allowlist, not a denylist.
 * Headers (cookies, authorization), the query string and the body are never logged.
 */
export function serializeRequestForLog(req: { id?: unknown; method?: string; url?: string }) {
  return { id: req.id, method: req.method, url: stripQuery(req.url) };
}

export function serializeResponseForLog(res: { statusCode?: number }) {
  return { statusCode: res.statusCode };
}
