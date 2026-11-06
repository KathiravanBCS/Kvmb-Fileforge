/** Request header the frontend must send on state-changing requests (value from GET /auth/csrf). */
export const CSRF_HEADER = 'x-csrf-token';

export const MICROSOFT_PROVIDER = 'microsoft';

/** Role seeded by fileforge_full_schema_v1_1.sql; looked up by code at runtime, never assumed to exist. */
export const OWNER_ROLE_CODE = 'owner';
