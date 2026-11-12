# Prisma

Prisma Migrate owns the database schema. `schema.prisma` is the source of truth and `migrations/` is the history that
builds `fileforge_db`. There are exactly two PostgreSQL schemas:

| Schema   | Holds                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------- |
| `public` | every application table: users, identities, workspaces, storage, central storage, sessions, audit events |
| `master` | lookup tables: entity types, storage provider types, tool types, job statuses, ...                       |

Every model carries `@@schema("public")` or `@@schema("master")`.

## Day to day

```bash
npm run db:migrate:dev -- --name add_something   # local dev: diff schema.prisma, write + apply a migration (needs a shadow DB)
npm run db:migrate:deploy                        # shared / production: applies pending migrations only, never resets
npm run db:migrate:status                        # what is applied, what is pending
npm run db:validate                              # prisma validate
npm run db:generate                              # regenerate the client (also runs on dev/build/test)
```

Never run `prisma db push` (it skips the hand-written SQL below) and never `prisma migrate reset` against a shared database.

## What Prisma cannot express

CHECK constraints, triggers, functions, expression indexes and seed rows are hand-written SQL inside the migration files
(`migrations/20261111000000_init/migration.sql`, second half). Prisma ignores them, so `migrate dev` does not drop them. When you
generate a new migration, **read it**: it should only contain your change. If a later change needs a new CHECK or trigger, add it
to that migration's SQL by hand (`migrate dev --create-only`, edit, then apply).

Known quirk: Postgres does not round-trip `x IN ('a', 'b')` partial-index predicates. `schema.prisma` therefore keeps the
`= ANY (ARRAY[...])` form Prisma reads back (`ix_central_files_needs_attention`, `ix_central_files_recovery_due`), while the init
migration creates those two indexes from the `IN (...)` text. `prisma migrate diff` reports no drift for either.

## Caveats when using the client

- Partial unique indexes (`WHERE NOT is_deleted`, `WHERE is_default`, ...) appear as `@unique` / `@@unique` with `where: raw(...)`.
  Prisma still generates a `findUnique` selector for them, but soft-deleted rows can share the key, so use `findFirst` with an
  explicit `is_deleted: false` filter instead (`uq_external_file`, `uq_folder_mapping_active`, `uq_default_storage_connection`,
  `uq_user_primary_identity`, `uq_system_admins_user`, `uq_central_file_item`).
- `user_identities.user_id` is modelled as a 1:1 relation only because of the partial unique index on the primary identity; a user
  may have several non-primary identities. Do not rely on the `users.user_identities` relation.
- `uq_users_email_lower` (lower(email)) and `uq_central_connection_single` are expression/constant indexes and exist only in SQL.
- `system_admins` is read-only for the application: rows are created only with `grant-system-admin.sql`.

## Scripts in this folder

| File                       | Purpose                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `grant-system-admin.sql`   | Makes `users.id = 1` a system administrator (per environment, after the first sign-in).                   |
| `wipe-legacy-schemas.sql`  | One-off, destructive: drops the old 12-schema layout so `migrate deploy` can rebuild. Dev databases only. |

## Moving a database from the old layout (core / storage / audit / master) to this one

1. Back up anything you want to keep (it is all deleted).
2. Run `wipe-legacy-schemas.sql` (pgAdmin Query Tool), confirming the first `SELECT` shows the development server.
3. `npm run db:migrate:deploy`
4. Start the API, sign in once, then run `grant-system-admin.sql` and reconnect the central OneDrive in the admin page.

The retired SQL files in `../docs/database/sql/` are kept only for history and must not be run.
