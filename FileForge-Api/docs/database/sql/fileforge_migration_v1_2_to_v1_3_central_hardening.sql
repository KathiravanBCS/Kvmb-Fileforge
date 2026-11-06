-- FILEFORGE AI v1.3 ADDITIVE MIGRATION: Central Storage production hardening.
-- PROPOSED, NOT APPLIED. Apply ONLY after the central storage v1.2 migration (live fileforge_db state). Review, back up, then run
-- in pgAdmin (Query Tool, F5). ONE transaction: if anything fails, nothing is applied. Not idempotent: a second run stops in the pre-flight.
--
-- What this adds (no existing row is modified; every new column on an existing table is nullable or has a default):
--   storage.central_files          + recovery bookkeeping columns (attempts, next retry, outcome, review flag, pending replacement values)
--   storage.central_upload_slots   NEW: upload admission control (rate limit + concurrency), shared by every backend instance
--   core.sessions                  NEW: persistent, ENCRYPTED server-side sessions (replaces the in-memory store in production)
--
-- Execution order:  1. this file   2. fileforge_verify_v1_3_central_hardening.sql (read-only)   (rollback: fileforge_rollback_v1_3_central_hardening.sql)
--
-- Safe to run while the API is up: the running v1.2 code keeps working (every new column is nullable or has a default, nothing it reads
-- or writes changed). The ALTER takes a brief exclusive lock on storage.central_files (128 kB, one row at the time of review).
-- If pgAdmin ever answers "current transaction is aborted" (25P02) after an error, run  ROLLBACK;  first: the script is one transaction.
-- All times in the application are compared with the DATABASE clock (now()), never with an instance's clock, so a skewed server cannot
-- extend a lease or shorten a rate window.

BEGIN;

DO $$
BEGIN
  IF to_regclass('storage.central_files') IS NULL OR to_regclass('storage.central_connection') IS NULL THEN
    RAISE EXCEPTION 'Pre-flight: the v1.2 central storage tables are missing. Apply the v1.2 migration first.';
  END IF;
  IF to_regclass('core.users') IS NULL THEN
    RAISE EXCEPTION 'Pre-flight: core.users is missing. Wrong database?';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'storage' AND table_name = 'central_files' AND column_name = 'recovery_attempts')
     OR to_regclass('storage.central_upload_slots') IS NOT NULL
     OR to_regclass('core.sessions') IS NOT NULL THEN
    RAISE EXCEPTION 'Pre-flight: part of this migration already exists. It was already applied (or partly applied by hand).';
  END IF;
END $$;


-- ---------------------------------------------------------------------------------------------------------------
-- 1. storage.central_files: recovery bookkeeping.
--    The reconciliation worker finds rows that are stuck (pending / uploading / replacing / deleting / failed and older than a
--    threshold), checks OneDrive, and repairs them. It needs to remember how often it tried and when to try next, and an
--    administrator needs to see which rows it gave up on. Existing columns (upload_status, last_error_code, updated_at) are reused.
--    pending_* hold what a replacement WILL be once it commits, so an interrupted replacement can be finished without guessing.
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE storage.central_files
  ADD COLUMN recovery_attempts SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN next_recovery_at TIMESTAMPTZ,
  ADD COLUMN last_recovery_at TIMESTAMPTZ,
  ADD COLUMN last_recovery_outcome VARCHAR(40),
  ADD COLUMN needs_review BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN review_reason VARCHAR(80),
  ADD COLUMN pending_size_bytes BIGINT,
  ADD COLUMN pending_checksum_sha256 VARCHAR(64),
  -- Per-row recovery lease: the lock that stays effective for the WHOLE repair of one file, on any backend instance. A worker claims a
  -- row with an atomic UPDATE (token + expiry), renews it while it works, and every write it makes afterwards must still present the
  -- same token. If the worker dies, the lease simply expires and another worker can take over.
  ADD COLUMN recovery_lease_token UUID,
  ADD COLUMN recovery_lease_until TIMESTAMPTZ,
  ADD CONSTRAINT central_files_recovery_attempts_check CHECK (recovery_attempts >= 0),
  ADD CONSTRAINT central_files_pending_size_check CHECK (pending_size_bytes IS NULL OR pending_size_bytes >= 0),
  ADD CONSTRAINT central_files_recovery_outcome CHECK (last_recovery_outcome IS NULL OR last_recovery_outcome IN ('repaired','retry_scheduled','needs_review','reauth_required','no_action','failed')),
  -- A lease always has both halves.
  ADD CONSTRAINT central_files_recovery_lease CHECK ((recovery_lease_token IS NULL) = (recovery_lease_until IS NULL)),
  -- A row flagged for manual review always says why.
  ADD CONSTRAINT central_files_review_reason CHECK (needs_review = false OR review_reason IS NOT NULL);

-- The worker's queue: stuck-looking rows that are due and not waiting for a person.
CREATE INDEX ix_central_files_recovery_due ON storage.central_files(next_recovery_at, id)
  WHERE upload_status IN ('pending','uploading','replacing','deleting','failed') AND needs_review = false;
-- The administrator's "needs review" list.
CREATE INDEX ix_central_files_review ON storage.central_files(updated_at DESC) WHERE needs_review = true;

COMMENT ON COLUMN storage.central_files.recovery_attempts IS 'How many times the reconciliation worker tried to repair this row. Bounded: after the limit the row is flagged needs_review.';
COMMENT ON COLUMN storage.central_files.next_recovery_at IS 'Earliest time the worker may look at this row again (exponential backoff). NULL = eligible once the row is stale.';
COMMENT ON COLUMN storage.central_files.recovery_lease_token IS 'Random token of the worker currently repairing this row. Every write of that repair is conditional on it, so two workers can never repair one file at the same time.';
COMMENT ON COLUMN storage.central_files.pending_size_bytes IS 'Size the content will have once an in-progress replacement commits (cleared when it finishes).';


-- ---------------------------------------------------------------------------------------------------------------
-- 2. storage.central_upload_slots: upload admission control.
--    One row per admitted upload / replacement. It answers three questions for ALL backend instances at once:
--    how many uploads did this user start in the window (rate), how many are running right now (concurrency), and how many
--    are running overall (global cap). Admission takes a per-user advisory lock, so parallel requests cannot slip past a limit.
--    A slot is released when the request ends, by its own lease_token only; a crashed instance cannot leak it, because every slot
--    has a lease that expires (the lease is set from the database clock when the slot is admitted).
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE storage.central_upload_slots (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES core.users(id),
  operation VARCHAR(20) NOT NULL,
  request_id TEXT,
  -- Held only in the memory of the request that was admitted (never sent to a browser): a slot can be released only by presenting
  -- its own token, so no other request (or a guessed slot id) can free somebody else's slot.
  lease_token UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  outcome VARCHAR(20),
  CONSTRAINT central_upload_slots_operation_check CHECK (operation IN ('upload','replace','admin_upload')),
  CONSTRAINT central_upload_slots_outcome_check CHECK (outcome IS NULL OR outcome IN ('completed','failed','cancelled','expired')),
  CONSTRAINT central_upload_slots_release_consistency CHECK ((released_at IS NULL AND outcome IS NULL) OR (released_at IS NOT NULL AND outcome IS NOT NULL))
);

-- Rate window: "this user's recent admissions of this kind".
CREATE INDEX ix_central_upload_slots_user_recent ON storage.central_upload_slots(user_id, operation, created_at DESC);
-- Concurrency: "slots still open" (per user, and overall).
CREATE INDEX ix_central_upload_slots_open ON storage.central_upload_slots(user_id, lease_expires_at) WHERE released_at IS NULL;
-- Housekeeping: old rows are deleted by the worker.
CREATE INDEX ix_central_upload_slots_created ON storage.central_upload_slots(created_at);

COMMENT ON TABLE storage.central_upload_slots IS 'Upload admission control shared by all backend instances: rate window, per-user and global concurrency. Rows are short-lived operational data (cleaned up by the worker).';


-- ---------------------------------------------------------------------------------------------------------------
-- 3. core.sessions: persistent server-side sessions.
--    The whole session payload (user, CSRF token, the user's Microsoft token cache, pending OAuth state) is stored ONLY as
--    AES-256-GCM ciphertext; PostgreSQL's own encryption at rest is not what protects the tokens. The key is
--    SESSION_ENCRYPTION_KEY (environment, never in the database). The primary key is the SHA-256 of the session id, so reading
--    this table does not reveal a usable session id. user_id (plain) exists only so a user's sessions can be revoked.
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE core.sessions (
  sid_hash BYTEA PRIMARY KEY,
  payload_ciphertext BYTEA NOT NULL,
  payload_nonce BYTEA NOT NULL,
  payload_auth_tag BYTEA NOT NULL,
  encryption_key_version SMALLINT NOT NULL DEFAULT 1,
  user_id BIGINT REFERENCES core.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT sessions_sid_hash_length CHECK (octet_length(sid_hash) = 32),
  CONSTRAINT sessions_nonce_length CHECK (octet_length(payload_nonce) = 12),
  CONSTRAINT sessions_tag_length CHECK (octet_length(payload_auth_tag) = 16),
  CONSTRAINT sessions_payload_not_empty CHECK (octet_length(payload_ciphertext) > 0),
  CONSTRAINT sessions_key_version CHECK (encryption_key_version > 0)
);

CREATE INDEX ix_sessions_expires ON core.sessions(expires_at);
CREATE INDEX ix_sessions_user ON core.sessions(user_id) WHERE user_id IS NOT NULL;

COMMENT ON TABLE core.sessions IS 'Persistent server-side sessions. Payload is AES-256-GCM ciphertext (key from SESSION_ENCRYPTION_KEY); the key of a row is sha256(session id).';

COMMIT;
