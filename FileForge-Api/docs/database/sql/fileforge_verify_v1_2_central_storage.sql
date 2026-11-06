-- FILEFORGE AI v1.2 VERIFY (read-only SELECTs). Run after the migration and the seed; paste or describe the results to Claude.
-- Each query says what a correct result looks like.

-- 1. The three new tables exist. Expect 3 rows.
SELECT table_schema, table_name FROM information_schema.tables
WHERE (table_schema, table_name) IN (('core','system_admins'), ('storage','central_connection'), ('storage','central_files'))
ORDER BY 1, 2;

-- 2. Existing tables were NOT altered. Expect storage.connections = 24 columns, storage.files = 25 columns.
SELECT table_name, count(*) AS column_count FROM information_schema.columns
WHERE table_schema = 'storage' AND table_name IN ('connections', 'files') GROUP BY table_name ORDER BY 1;

-- 3. Constraints on the new tables (expect the *_check / *_consistency / *_format / *_length / *_states / *_has_item names).
SELECT conrelid::regclass AS table_name, conname, contype FROM pg_constraint
WHERE conrelid IN ('core.system_admins'::regclass, 'storage.central_connection'::regclass, 'storage.central_files'::regclass)
  AND contype IN ('c', 'u', 'f')
ORDER BY 1, 3, 2;

-- 4. Indexes. Expect uq_system_admins_user, uq_central_connection_single, uq_central_file_item, uq_central_file_stored_name, ix_central_*.
SELECT tablename, indexname FROM pg_indexes
WHERE (schemaname, tablename) IN (('core','system_admins'), ('storage','central_connection'), ('storage','central_files'))
ORDER BY 1, 2;

-- 5. Triggers. Expect trg_system_admins_updated_at, trg_central_connection_updated_at, trg_central_connection_identity, trg_central_files_updated_at.
SELECT event_object_table, trigger_name FROM information_schema.triggers
WHERE event_object_schema IN ('core', 'storage') AND event_object_table IN ('system_admins', 'central_connection', 'central_files')
ORDER BY 1, 2;

-- 6. New entity types. Expect 2 rows.
SELECT id, code FROM master.entity_types WHERE code IN ('central_file', 'central_storage_connection') ORDER BY code;

-- 7. Data. Expect: system_admins = 1 (after the seed), central_connection = 0, central_files = 0, existing storage.files unchanged (6 rows).
SELECT 'core.system_admins' AS t, count(*) FROM core.system_admins
UNION ALL SELECT 'storage.central_connection', count(*) FROM storage.central_connection
UNION ALL SELECT 'storage.central_files', count(*) FROM storage.central_files
UNION ALL SELECT 'storage.files (existing)', count(*) FROM storage.files;

-- 8. The administrator. Expect one row: user_id 1, is_active true.
SELECT user_id, is_active, granted_at FROM core.system_admins WHERE is_deleted = false;
