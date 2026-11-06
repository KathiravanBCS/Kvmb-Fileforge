-- FILEFORGE AI v1.2 ROLLBACK: removes everything fileforge_migration_v1_1_to_v1_2_central_storage.sql added.
-- DESTRUCTIVE: drops central file metadata and the encrypted central token cache. Files already uploaded stay in OneDrive
-- (FileForge-Central/) as orphans; this script never touches OneDrive. Use only before real data exists, or after a backup.
-- It refuses to run while central_files has rows or a central connection exists. To proceed anyway, delete those rows
-- yourself first (deliberately), then run this script.
-- Does NOT touch storage.files, storage.connections, or any existing row.

BEGIN;

DO $$
DECLARE
  files_count BIGINT := 0;
  connection_count BIGINT := 0;
BEGIN
  IF to_regclass('storage.central_files') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM storage.central_files' INTO files_count;
  END IF;
  IF to_regclass('storage.central_connection') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM storage.central_connection' INTO connection_count;
  END IF;
  IF files_count > 0 OR connection_count > 0 THEN
    RAISE EXCEPTION 'Rollback refused: storage.central_files has % row(s) and storage.central_connection has % row(s). Remove them deliberately first.', files_count, connection_count;
  END IF;
END $$;

DROP TABLE IF EXISTS storage.central_files;
DROP TABLE IF EXISTS storage.central_connection;
DROP FUNCTION IF EXISTS storage.guard_central_connection_identity();
DROP TABLE IF EXISTS core.system_admins;

-- Entity-type codes: removed only when nothing references them (audit rows are append-only and keep their FK).
DELETE FROM master.entity_types et
WHERE et.code IN ('central_file', 'central_storage_connection')
  AND NOT EXISTS (SELECT 1 FROM audit.events e WHERE e.entity_type_id = et.id)
  AND NOT EXISTS (SELECT 1 FROM audit.entity_versions v WHERE v.entity_type_id = et.id)
  AND NOT EXISTS (SELECT 1 FROM storage.file_links fl WHERE fl.entity_type_id = et.id);

COMMIT;
