/** Global route prefix: every endpoint lives under /api/v1 (e.g. /api/v1/auth/me, /api/v1/docs). */
export const API_PREFIX = 'api/v1';

/** Where Microsoft must redirect after sign-in. Must equal the Web redirect URI registered in Entra ID. */
export const MICROSOFT_CALLBACK_PATH = `/${API_PREFIX}/auth/microsoft/callback`;
