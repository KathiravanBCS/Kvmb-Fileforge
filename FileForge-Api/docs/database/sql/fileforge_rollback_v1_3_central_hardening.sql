-- FILEFORGE AI v1.3 ROLLBACK: removes everything fileforge_migration_v1_2_to_v1_3_central_hardening.sql added. PROPOSED, NOT APPLIED.
-- Effects: everybody is signed out (core.sessions is dropped), upload limits reset, and recovery bookkeeping is lost.
-- STOP THE API FIRST (or at least set CENTRAL_RECOVERY_ENABLED=false and SESSION_STORE=memory and restart it): the v1.3 code needs these
-- objects, so running instances would fail while they are gone. After rolling back, deploy the v1.2 code (or the v1.3 code with those settings).
-- It never touches OneDrive or any file row's own data: only the added columns of storage.central_files are dropped. It refuses to run
-- while rows still wait for manual review or hold a live recovery lease, so a problem file is never silently forgotten or mid-repair.
-- If pgAdmin answers "current transaction is aborted" (25P02) after an error, run  ROLLBACK;  first.

BEGIN;

DO $$
DECLARE
  review_count BIGINT := 0;
  leased_count BIGINT := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'storage' AND table_name = 'central_files' AND column_name = 'needs_review') THEN
    EXECUTE 'SELECT count(*) FROM storage.central_files WHERE needs_review = true' INTO review_count;
    EXECUTE 'SELECT count(*) FROM storage.central_files WHERE recovery_lease_until > now()' INTO leased_count;
  END IF;
  IF review_count > 0 THEN
    RAISE EXCEPTION 'Rollback refused: % file(s) are flagged needs_review. Resolve them (or clear the flag deliberately) first.', review_count;
  END IF;
  IF leased_count > 0 THEN
    RAISE EXCEPTION 'Rollback refused: % file(s) are being repaired right now (live recovery lease). Stop the API and wait for the leases to expire (a few minutes).', leased_count;
  END IF;
END $$;

DROP TABLE IF EXISTS core.sessions;
DROP TABLE IF EXISTS storage.central_upload_slots;

DROP INDEX IF EXISTS storage.ix_central_files_recovery_due;
DROP INDEX IF EXISTS storage.ix_central_files_review;

ALTER TABLE storage.central_files
  DROP CONSTRAINT IF EXISTS central_files_recovery_attempts_check,
  DROP CONSTRAINT IF EXISTS central_files_pending_size_check,
  DROP CONSTRAINT IF EXISTS central_files_review_reason,
  DROP CONSTRAINT IF EXISTS central_files_recovery_outcome,
  DROP CONSTRAINT IF EXISTS central_files_recovery_lease,
  DROP COLUMN IF EXISTS recovery_lease_token,
  DROP COLUMN IF EXISTS recovery_lease_until,
  DROP COLUMN IF EXISTS recovery_attempts,
  DROP COLUMN IF EXISTS next_recovery_at,
  DROP COLUMN IF EXISTS last_recovery_at,
  DROP COLUMN IF EXISTS last_recovery_outcome,
  DROP COLUMN IF EXISTS needs_review,
  DROP COLUMN IF EXISTS review_reason,
  DROP COLUMN IF EXISTS pending_size_bytes,
  DROP COLUMN IF EXISTS pending_checksum_sha256;

COMMIT;
