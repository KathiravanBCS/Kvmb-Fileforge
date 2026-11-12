# Identity provisioning (first sign-in)

Source of truth: `prisma/schema.prisma` and `prisma/migrations` (Prisma Migrate; PostgreSQL schemas `public` and `master`). Never run
`prisma db push` or `prisma migrate reset` against a shared `fileforge_db`; see `prisma/README.md`.

> **Status: verified once against the real `fileforge_db` (2026-11-04).** A real Microsoft sign-in (personal account) created exactly one row
> in each of `users`, `user_identities`, `workspaces` and `workspace_members`, and all integrity checks held (see the end).
> Not yet exercised against the real database: a **second** sign-in of the same user (idempotency), an organizational account, and the
> `email_in_use` refusal. These are covered by mocked tests only.
>
> That verification ran on the previous multi-schema layout (`core`, `storage`, `audit`). The tables and columns are unchanged; they now live in
> `public` (and the lookup tables in `master`), and the database is rebuilt from `prisma/migrations`, so sign in again to re-verify.

## Tables used

| Table | Used for | Notes from the schema |
|---|---|---|
| `user_identities` | Canonical external identity | `UNIQUE (provider, issuer, subject)`; `is_primary` unique per user |
| `users` | The FileForge user | `id BIGINT`; `email NOT NULL`; `display_name` nullable; `UNIQUE INDEX lower(email) WHERE NOT is_deleted` |
| `workspaces` | Personal workspace | `slug UNIQUE`; `workspace_type IN ('personal','team')`; `owner_user_id NOT NULL` |
| `workspace_members` | Owner membership | `UNIQUE (workspace_id, user_id)`; `role_id NOT NULL` |
| `roles` | The `owner` role | Looked up by `code`; seeded by the init migration but **never assumed** |

`prisma/schema.prisma` models only these five tables, written by hand from the SQL. Replace it with `prisma db pull` output when `DATABASE_URL` is available.

## Algorithm (`UserProvisioningService.resolveOrProvision`)

1. Look up `user_identities` by **`(provider='microsoft', issuer, subject)`** only. Email is never used to find or merge accounts.
2. Found: refuse if the identity or user is soft-deleted / inactive; otherwise set `last_login_at` and return the user.
3. Not found, in **one transaction**:
   1. find role `owner` (`is_deleted = false`) → if missing, **abort** (`owner_role_missing`), nothing is created;
   2. refuse if another non-deleted user already has this email (case-insensitive) → `email_in_use`;
   3. insert `users` (`auth_provider='microsoft'`, `email`, `display_name` or `NULL`, `last_login_at`);
   4. insert `user_identities` (`account_type`, `issuer`, `subject`, `tenant_id`, `home_account_id`, `provider_user_id`, `login_hint`, `is_primary=true`);
   5. insert `workspaces` (`slug = personal-<user id>`, `workspace_type='personal'`, `owner_user_id`);
   6. insert `workspace_members` with the `owner` role id from step 1.
4. A concurrent first sign-in of the same identity (unique violation) is resolved by looking the identity up again; if it still does not exist the sign-in is refused.

Any failure means **no session**: the browser is sent to `/?auth_error=service_unavailable` or `account_unavailable`.

## Identity key

`subject` is the ID token's **`oid`**, `provider_user_id` is `sub`, `issuer` is `https://login.microsoftonline.com/<tid>/v2.0`.
`oid` is stable for an account across app registrations, whereas `sub` is unique per application and would change if the Entra app were ever re-created.
Personal accounts always have `tid = 9188040d-6c67-4c5b-b112-36a304b66dad`, so a personal and a work account are always different identities.

## Known conflict between the requirement and the schema

"A personal and an organizational account with the same email must not become the same user" collides with `uq_users_email_lower`, which allows **one
non-deleted `users` row per email**. The second identity therefore cannot get its own user, and is **refused** (`email_in_use`) rather than merged.

Options (need a decision, none is implemented):
1. Keep refusing, and add an explicit *account linking* flow (sign in with the existing identity, then link the second one: a verified, user-initiated action).
2. Relax the unique index (a schema change; needs approval).

## Fields

- `users.id` is a BIGINT; the service keeps it as `bigint`, the session and `/auth/me` carry it as a decimal string.
- `display_name` is stored as `NULL` when the token has no `name`; the UI falls back to the email.
- `created_by` / `updated_by` are left `NULL` (no FK in the schema; no actor exists before the user does).

## Database role and connection

- `DATABASE_URL=postgresql://…?sslmode=require` (Azure). Certificate verification is **not** disabled.
- A least-privilege application role needs `SELECT, INSERT, UPDATE` on the five tables (identity columns need no separate sequence grant) and nothing else for Phase 1D.
- The connection is lazy, so the API starts even if the database is down; the login then fails with `service_unavailable`.

## Verified on the real database (2026-11-04, read-only queries)

After the first real sign-in: 1 user (`auth_provider='microsoft'`), 1 identity (`account_type='personal'`, issuer = personal-account tenant,
`is_primary`), 1 workspace (`slug='personal-1'`, `workspace_type='personal'`), 1 membership (`owner`, `active`). Zero users without exactly one
primary identity, zero personal workspaces without an active owner membership, zero duplicate emails. `roles` contains
`owner, admin, editor, viewer`; `permissions` is empty.

## What a real run must confirm

1. `SELECT code FROM roles WHERE NOT is_deleted;` contains `owner` (the init migration seeds it; confirm in the live DB).
2. The first sign-in creates exactly one row in each of the five tables for the new user.
3. A second sign-in creates no rows and only updates `last_login_at`.
4. `permissions` / `role_permissions` are **empty** by design of the schema. Authorization in this phase is by role *code* per workspace only (`WorkspaceAccessGuard`).
