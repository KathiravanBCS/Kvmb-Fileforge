-- FILEFORGE AI v1.2 SEED: grant system-administrator access to core.users.id = 1.
-- Run ONLY after fileforge_migration_v1_1_to_v1_2_central_storage.sql succeeded.
-- This is the ONLY way an administrator is created: no API writes core.system_admins.
-- Run the three steps separately in pgAdmin (select the statement, then F5).

-- STEP 1 (read-only): confirm user 1 is really the person who should administer all users' files.
SELECT u.id, u.email, u.display_name, u.is_active, ui.provider, ui.account_type, ui.is_primary
FROM core.users u
LEFT JOIN core.user_identities ui ON ui.user_id = u.id AND ui.is_deleted = false
WHERE u.id = 1;

-- STEP 2 (writes one row): grant. ONE statement, no BEGIN/COMMIT, so it cannot leave pgAdmin in an aborted transaction.
-- Inserts only if user 1 exists and is active; safe to re-run (does nothing if user 1 already has a live row).
-- If a previous run left the tab showing "current transaction is aborted" (25P02), run   ROLLBACK;   first.
INSERT INTO core.system_admins(user_id, granted_by, note)
SELECT u.id, u.id, 'Initial system administrator (bootstrap, granted by reviewed SQL)'
FROM core.users u
WHERE u.id = 1 AND u.is_active = true AND u.is_deleted = false
ON CONFLICT (user_id) WHERE is_deleted = false DO NOTHING;
-- Expect "INSERT 0 1" the first time. "INSERT 0 0" means user 1 is missing/inactive or already an administrator (see step 3).

-- STEP 3 (read-only): expect exactly one row, is_active = true.
SELECT sa.id, sa.user_id, sa.is_active, sa.granted_at, sa.note FROM core.system_admins sa WHERE sa.is_deleted = false;

-- To REVOKE later (takes effect on the next request, nothing else to change):
--   UPDATE core.system_admins SET is_active = false WHERE user_id = 1 AND is_deleted = false;
