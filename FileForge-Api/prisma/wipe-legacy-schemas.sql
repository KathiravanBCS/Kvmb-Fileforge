-- ONE-OFF, DESTRUCTIVE: removes the old 12-schema layout so `prisma migrate deploy` can build the two-schema layout
-- ("public" + "master") from scratch. Run it ONCE per database that still has the old layout, then run `npm run db:migrate:deploy`.
--
-- It irreversibly deletes ALL data: users, identities, workspaces, files metadata, sessions, the encrypted central OneDrive
-- token cache and the audit trail. After it: sign in again (your user is re-created), re-grant the administrator
-- (prisma/grant-system-admin.sql) and reconnect the central OneDrive in the admin page. Files in OneDrive itself are untouched.
--
-- Never run this on a production database. Make sure the connection points at the development server first:
SELECT current_database() AS database, inet_server_addr() AS server, current_user AS role;

BEGIN;

-- Old layout: core, storage, audit, master, plus the schemas that never held application code.
DROP SCHEMA IF EXISTS core, storage, audit, master, contact, processing, scanner, qr, scraper, document, email, billing CASCADE;

-- "public" is deliberately NOT dropped: on Azure it is owned by azure_pg_admin, and the old layout kept nothing in it.

COMMIT;

-- Expect no rows besides the system schemas:
SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema' ORDER BY nspname;
