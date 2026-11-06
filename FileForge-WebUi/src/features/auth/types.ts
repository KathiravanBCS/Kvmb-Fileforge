import { z } from 'zod';

import type { ApiError } from '@/lib/api-types';

// Response of GET /auth/me. Matches FileForge-Api (asserted by its auth.flow.spec.ts) and core.users
// (fileforge_full_schema_v1_1.sql).
// - id: core.users.id is BIGINT, so it is sent as a decimal string (a JS number loses precision).
// - email: NOT NULL. displayName: nullable, so the UI falls back to the email.
// - Roles are not here: they are per workspace (core.workspace_members -> core.roles).
export const authUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  displayName: z.string().nullable().default(null),
});

export type AuthUser = z.infer<typeof authUserSchema>;

/**
 * - `preview`: development only. The auth endpoints are unreachable, so the shell is shown
 *   WITHOUT a session. It is never an authenticated state and carries no user.
 */
export type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'authenticated'; user: AuthUser }
  | { status: 'unauthenticated'; user: null }
  | { status: 'preview'; user: null }
  | { status: 'error'; user: null; error: ApiError };

export interface AuthActions {
  /** Redirects the browser to the backend, which starts the Microsoft sign-in. */
  login: () => void;
  logout: () => Promise<void>;
  refetch: () => void;
}

export type AuthContextValue = AuthState & AuthActions;
