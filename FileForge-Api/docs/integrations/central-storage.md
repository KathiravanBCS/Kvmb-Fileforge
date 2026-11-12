# Central Storage (all users' files in the administrator's OneDrive)

All FileForge users upload to ONE OneDrive owned by the system administrator. FileForge enforces who may see what:
a normal user only ever reaches their own files, a system administrator reaches everyone's.
This is independent of the personal OneDrive File Manager (`/workspaces/:id/storage/onedrive`), which is kept for a future premium tier.

## Layout in OneDrive

```
OneDrive/
├── FileForge/                    personal File Manager (unchanged)
└── FileForge-Central/            central storage (a SIBLING, never inside FileForge/)
    └── users/<database user id>/<random uuid>[.ext]
```

The OneDrive item is named by a generated uuid. The user's file name lives only in PostgreSQL (`central_files.display_name`),
so a rename never touches OneDrive. The account owner can of course still open these files in OneDrive itself; FileForge only
guarantees that **its own APIs** enforce ownership.

## Who is an administrator

`system_admins` (a live row for the user, and the user active). Checked in PostgreSQL on every request and again before every
administrator write. Nothing in the API can create a grant; rows are inserted by reviewed SQL
(`prisma/grant-system-admin.sql`). Workspace roles (`owner`, `admin`, ...) are not administrator rights.
To revoke: `UPDATE system_admins SET is_active = false WHERE user_id = <id>;` (effective on the next request).

## Endpoints (`/api/v1`)

| Method | Path | Who |
|---|---|---|
| GET | `/central-storage/capabilities` | any signed-in user |
| GET | `/central-storage/files` `?page&pageSize&search&type&sort&order` | own files |
| POST | `/central-storage/files/upload` (multipart `file`, max 50 MB) | own |
| GET | `/central-storage/files/:id` · `/download` · `/preview` | own |
| PATCH | `/central-storage/files/:id` `{ name }` | own (extension must stay) |
| PUT | `/central-storage/files/:id/content` (multipart `file`) | own |
| DELETE | `/central-storage/files/:id` | own |
| GET | `/central-storage/usage` | own |
| GET | `/admin/central-storage/files` (+ `ownerUserId`) · `/files/:id` · `/download` · `/preview` | system admin |
| POST | `/admin/central-storage/users/:userId/files/upload` | system admin |
| PATCH / PUT / DELETE | `/admin/central-storage/files/:id` (`/content` for PUT) | system admin |
| POST | `/admin/central-storage/files/:id/resync` | system admin |
| GET | `/admin/central-storage/users` · `/users/:userId/files` · `/usage` | system admin |
| GET | `/admin/central-storage/connection` | system admin |
| POST | `/admin/central-storage/connection/connect` · `/connection/verify` | system admin |
| GET | `/admin/central-storage/recovery/summary` · `/recovery/items?state=all\|needs_review\|retrying\|waiting` · `/recovery/items/:id` | system admin |
| POST | `/admin/central-storage/recovery/items/:id/retry` · `/recovery/items/:id/dismiss` | system admin |

Errors use the usual `{ error: { code, message, requestId } }`. Someone else's file, a missing file and a malformed id all answer the
same `404 FILE_NOT_FOUND`. Other codes: `FILE_TOO_LARGE` 413, `FILE_TYPE_NOT_ALLOWED`, `FILE_CONTENT_MISMATCH`, `EMPTY_FILE` 400,
`PREVIEW_NOT_SUPPORTED` 415, `FILE_BUSY` 409, `CENTRAL_STORAGE_QUOTA_EXCEEDED` 507, `CENTRAL_STORAGE_RECONNECT_REQUIRED` /
`CENTRAL_STORAGE_NOT_CONNECTED` 503 (never 401: a lost central authorization must not sign users out).
Upload limits answer **429** with a `Retry-After` header and `retryAfterSeconds` in the body (see "Upload limits"). Recovery: `RECOVERY_BUSY`
409 (a worker holds the file), `NOT_RECOVERABLE` 409, `NOT_IN_REVIEW` 409.

## The central OneDrive connection

1. An administrator calls `POST /admin/central-storage/connection/connect`, and is sent to Microsoft for **Files.ReadWrite** consent
   (the same single redirect URI as sign-in; the flow is told apart by the server-side purpose `connect_central_storage`).
2. On return the server re-checks everything: still an administrator, the consenting Microsoft account is exactly the account they
   signed in with (issuer + subject, never e-mail) and is linked to that user in `user_identities`.
3. It creates/adopts `FileForge-Central/` and `FileForge-Central/users/`, then stores the MSAL token cache **only as AES-256-GCM
   ciphertext** in `central_connection` (fresh random 12-byte nonce per write; the key version, row id and account subject are
   authenticated data). A different Microsoft account can never replace the connection (checked in code and by a database trigger).
4. Landing page: `/admin/storage/settings?central=connected`, or `?central_error=<code>` (`access_denied`, `consent_required`,
   `session_expired`, `account_mismatch`, `central_storage_forbidden`, `central_storage_unavailable`, `login_failed`).

It keeps working while nobody is signed in: it uses the stored refresh token, not any user session. Token refresh is serialized with a
PostgreSQL advisory lock and every cache write is compare-and-swap on `cache_revision`, so several instances cannot overwrite each other.

### Encryption key

`CENTRAL_STORAGE_ENCRYPTION_KEY`: 32 random bytes (base64/base64url/64 hex), required at startup, never logged or returned.
Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. If it is lost or changed, the stored cache cannot be
read: the connection is marked `error` and an administrator reconnects (files in OneDrive are not affected). The connection is never
silently replaced or "repaired". `CENTRAL_STORAGE_ENCRYPTION_KEY_VERSION` (default 1) is stored with each ciphertext for future rotation.

## Failure and recovery

| Situation | Behaviour |
|---|---|
| Upload: OneDrive fails | row `failed` + hidden, error reaches the user (quota -> 507) |
| Upload: OneDrive ok, database fails | the new item is deleted again, row `failed` |
| Replace: OneDrive fails | back to `ready`, old content intact |
| Replace: only the database fails | stays `replacing` (still readable) with `last_error_code`; **admin resync** repairs it; a stale `replacing` (10+ min) can be replaced again |
| Delete: OneDrive refuses | file restored and visible again |
| Delete: even the restore fails | row stays `deleting` (hidden); an **administrator** can retry the delete |
| Lost Microsoft authorization | status `reauth_required`; users get 503; administrator reconnects |
| Graph 429 / 5xx | bounded retries (3) for reads, deletes and chunk uploads only; creating an item is never retried blindly |
| The server crashes or restarts mid-operation | the **recovery worker** (below) reconciles the row with what OneDrive really holds |

Rows needing attention are covered by index `ix_central_files_needs_attention` (statuses `pending`, `uploading`, `replacing`, `deleting`, `failed`).

## Upload limits (rate limiting and concurrency)

Enforced by the server, in PostgreSQL (`central_upload_slots`), so every backend instance sees the same numbers. Defaults (all configurable,
see "Production configuration"):

| Limit | Default |
|---|---|
| Uploads per user | 10 per 10 minutes |
| Replacements per user | 10 per 10 minutes |
| Administrator uploads (for users) | 60 per 10 minutes |
| Running uploads per user | 3 |
| Running uploads, all users and administrators together | 8 |

- **Where:** `UploadAdmissionGuard` on the four upload/replace routes. It runs after the global authentication and CSRF checks and the administrator
  guard, and **before** the upload interceptor reads a single byte: an unauthenticated, CSRF-failing or non-administrator request takes no capacity, and an
  over-limit user is refused without their file being received. A request that declares more than 50 MB (+1 MB multipart overhead) gets 413 before it is admitted.
- **Atomic:** admission is one transaction under a PostgreSQL advisory lock (`CENTRAL_ADMISSION_LOCK_KEY`), so two parallel requests on any instance are decided
  one after the other. A refused request records nothing.
- **Leases:** every slot has a random `lease_token` that never leaves the server; it is released (on success, failure or cancellation) only by presenting its own
  token. If an instance dies, the slot's lease expires (`CENTRAL_UPLOAD_SLOT_LEASE_MINUTES`) and it is freed anyway. All times use the **database** clock.
- **Answers:** 429 with `UPLOAD_RATE_LIMITED` (window used up; `Retry-After` is when the oldest admission leaves the window), `UPLOAD_TOO_MANY_ACTIVE`
  (3 running) or `UPLOAD_CAPACITY_BUSY` (8 running overall).
- **Frontend:** on `UPLOAD_RATE_LIMITED` the upload queue stops and says when to retry; on a busy answer it waits the time the server named (at most 30 s) and
  retries the same file up to twice; the replace dialog shows the message as a "please wait" notice rather than an error.

## Recovery of interrupted operations

An operation can be interrupted by a crash, a restart or a lost database connection. `CentralRecoveryService` reconciles PostgreSQL with OneDrive. It compares
what OneDrive holds at the file's own, server-generated path with what PostgreSQL recorded **before** the operation started (size, checksum, eTag; a replacement
records `pending_size_bytes` / `pending_checksum_sha256` when it claims the file).

| Left in | OneDrive holds | Result |
|---|---|---|
| `uploading` / `pending` | the item, with the expected size | recorded: `ready` |
| `uploading` / `pending` | nothing | `failed` (hidden) |
| `uploading` / `pending` | something of another size, or a folder | **needs review** |
| `replacing` | the same eTag as before | old content intact: back to `ready` |
| `replacing` | a changed eTag and the pending size | the replacement landed: recorded, version +1 |
| `replacing` | anything else, or the item is missing | **needs review** |
| `deleting` | the item | the delete the owner/administrator asked for is finished (`deleted`) |
| `deleting` | nothing | `deleted` |
| `failed` | an item at the file's path | **needs review** (the item is **never** deleted automatically: "failed" in the database does not prove the bytes are garbage) |
| `failed` | nothing | nothing to do |

- **Not touched:** anything younger than `CENTRAL_RECOVERY_STALE_MINUTES` (must be longer than the upload slot lease, so a request that is still running is never
  "repaired"), `ready` and `deleted` rows, and rows parked for review.
- **Locking:** each file is owned through a **lease on its row** (token + expiry, judged by the database clock), taken with one conditional `UPDATE`. It is
  renewed before every OneDrive call, and every write the worker makes carries the token, "lease not expired" and "status unchanged" in its `WHERE` clause. A
  worker that stalls past its lease cannot write anything; another instance takes over; a user operation that changes the file meanwhile turns the worker's
  final write into a no-op. No connection is held open for the duration, so this holds across any number of instances. (Advisory locks are used only for
  short jobs: slot admission and the slot housekeeping.)
- **Retries:** transient failures are retried with a growing delay (2, 4, 8 ... minutes, at most 6 h); after `CENTRAL_RECOVERY_MAX_ATTEMPTS` the file goes to
  review. A lost OneDrive authorization is *waiting*, not a failed attempt (retried every 15 minutes).
- **Audit:** every repair and every handover to an administrator is written to `events` (`actor_type = 'system'`, or the administrator who pressed
  "Retry now"); ids, statuses and codes only.
- **Off by default.** `CENTRAL_RECOVERY_ENABLED=false` until you turn it on deliberately. The administrator page works either way.
- **Administrator page** `/admin/storage/recovery`: counts, the three queues (*needs review*, *retrying*, *waiting*), a plain-language explanation of each file,
  its history, **Retry now** (runs the same checks immediately, after a confirmation) and **Mark as reviewed** (takes it out of the review queue; changes nothing
  in OneDrive). Both are audited and fail closed if the audit row cannot be written.

## Sessions in production

Development uses express-session's in-memory store. **Production refuses to start without `SESSION_STORE=postgres`**: sessions are kept in
`sessions`, because they hold each user's Microsoft token cache.

- AES-256-GCM, fresh random 12-byte nonce per write, key `SESSION_ENCRYPTION_KEY` — a **different** key from `CENTRAL_STORAGE_ENCRYPTION_KEY` (startup fails if they
  are equal), so one leaked key never opens both and they rotate independently.
- The session id is a secret: only its SHA-256 is stored, and it is part of the authenticated data, so a row copied under another id does not decrypt.
- A row that cannot be authenticated (wrong key, tampered, other key version) is treated as "no session" and removed: the user signs in again.
- The lifetime is fixed when the session is created (no sliding expiry); expired rows are deleted every 10 minutes by every instance (idempotent).
- Rotating the key signs everyone out. Nothing about a session (id, payload, key) is ever logged.
- The store has its **own small pool** (`SESSION_STORE_POOL_MAX`), so a burst of API queries cannot starve sign-ins.

## Production configuration

| Variable | Notes |
|---|---|
| `NODE_ENV=production`, `FRONTEND_URL=https://…`, `TRUST_PROXY=true` behind a TLS proxy | Secure `__Host-` cookies |
| `SESSION_STORE=postgres`, `SESSION_ENCRYPTION_KEY`, `SESSION_ENCRYPTION_KEY_VERSION` | required in production; new random 32-byte key, different from the central key |
| `CENTRAL_STORAGE_ENCRYPTION_KEY` | as before |
| `DATABASE_POOL_MAX` (10), `SESSION_STORE_POOL_MAX` (3), `DATABASE_INSTANCE_COUNT` (1), `DATABASE_CONNECTION_LIMIT` (40) | see the budget below |
| `CENTRAL_UPLOAD_*` | the limits above |
| `CENTRAL_RECOVERY_ENABLED` (false), `_INTERVAL_SECONDS` (60), `_STALE_MINUTES` (30), `_BATCH_SIZE` (10), `_MAX_ATTEMPTS` (6), `_LEASE_MINUTES` (5) | recovery |

**Connection budget.** Azure Database for PostgreSQL allows 50 connections in total and reserves about 10 for the platform, so about **40** are usable by *all*
backend instances and every tool (pgAdmin, migrations) together. Each instance opens `DATABASE_POOL_MAX` + `SESSION_STORE_POOL_MAX` connections at most. The API
**refuses to start** if `DATABASE_INSTANCE_COUNT × (DATABASE_POOL_MAX + SESSION_STORE_POOL_MAX) > DATABASE_CONNECTION_LIMIT`. Examples: 3 instances × (10 + 3) = 39 fits;
4 × 13 = 52 does not (use 4 × (6 + 2) = 32). Leave headroom for administration. Set `DATABASE_INSTANCE_COUNT` honestly: it is how the rule knows.

## Personal File Manager isolation

Graph permissions apply to the whole OneDrive account, so the File Manager enforces its own boundary: it never accepts ids (only relative
paths resolved under the stored `FileForge` root item), and now also verifies Graph's ancestry for every item
(`modules/storage/storage-roots.ts`): anything not inside `FileForge/` (including all of `FileForge-Central/`) is refused with
`403 ITEM_OUTSIDE_STORAGE_ROOT`; when Graph gives no path the parent chain is walked to the root. Tests: `onedrive-root-confinement.spec.ts`.

## Tests

`npm test` covers: encryption and the vault (restart, tampering, wrong key, concurrent refresh, compare-and-swap, lost consent),
the connection flow (wrong account, no replacement), administrator authorization (grant/revoke, workspace owners), user isolation for every
operation, the full upload/replace/delete lifecycle and its failure paths, the Graph layer (chunked upload, resume, quota, cancellation,
retries), the HTTP layer with real guards and CSRF, and the File Manager root confinement.
Production hardening adds tests for: admission (limits, windows, concurrency, parallel requests on one and on two instances, token-only release, lease
expiry, database clock, 429 body and header over HTTP, nothing consumed by requests refused earlier), the recovery decision table, lease/locking behaviour
(two instances, expired lease, stalled worker, renewal, concurrent user operation), "failed" rows never deleting anything, the worker's timers, the
administrator recovery API (authorization, audit-first, 409s, no OneDrive identifiers in responses), the encrypted session store (nothing in plaintext,
tamper, wrong key, expiry, logout, fixation, persistence across a restart) and the configuration rules (key separation, connection budget).
**Not covered by automated tests:** real Microsoft consent and real OneDrive calls (they need a person and the real account), and real PostgreSQL
concurrency (the tests use an in-memory fake that models the advisory locks and conditional updates; see the manual checklist in the report).

## Frontend (FileForge-WebUi, `src/features/central-storage/`)

| Route | Who | What |
|---|---|---|
| `/my-files` | any signed-in user | own files: upload (drag and drop, progress, cancel, max 50 MB), search, type filter, sort, paging, preview, download, rename, replace, delete, details, usage |
| `/admin/storage` | system administrators | everyone's files with owner column and owner filter, per-user usage, upload for a selected user, every action on any file; actions on other users' files say they are audited |
| `/admin/storage/settings` | system administrators | connect / reconnect the central OneDrive, connection status and account, "Check connection", OneDrive quota |
| `/admin/storage/recovery` | system administrators | interrupted operations: counts, queues (needs review / retrying / waiting), details and history, "Retry now", "Mark as reviewed" |

- **Permissions in the UI** come from the API: `GET /central-storage/capabilities` returns `isSystemAdmin`, and the CASL ability (`lib/casl`) is derived from it.
  A workspace role never grants administration (CASL `manage all` was removed on purpose: it would cover the administration subject for every
  workspace owner, i.e. every user). The sidebar hides the admin entries and the admin pages refuse to render (and request nothing) unless
  the API confirmed the user is an administrator. The API stays the authority and answers 403 regardless.
- **Disconnected storage:** `available: false` shows an explanation, disables upload / replace / download / preview / delete (rename only changes
  the database), and never shows a success state. Administrators get a link to the settings page.
- **Table:** the kvmb data grid 0.2 split (`DataGridRoot` + `DataGridView` + `GlobalSearch`, `ColumnManager`, `DensityMenu`) in server mode: the server
  searches, sorts and pages; the grid only reports what was asked.
- **Privacy:** every query key carries the signed-in user's id; the whole cache is dropped when the user changes or the session ends; file
  content (previews) is never kept in the query cache; previews render only images, PDF and plain text (text as text), after re-checking the
  blob's own type; downloads are bytes through the API, never a OneDrive link; no token ever reaches the browser.
- **Tests:** `npm test` in FileForge-WebUi (Vitest + Testing Library): abilities, navigation, API layer, upload queue, each page, preview safety,
  cache clearing, and a File Manager regression suite.

## Production-readiness follow-ups

Done in the production-hardening checkpoint (SQL v1.3 `fileforge_migration_v1_2_to_v1_3_central_hardening.sql`): upload rate limiting and concurrency
control, automatic recovery of interrupted operations (opt-in), the administrator recovery page, and encrypted PostgreSQL sessions.

Still open:

1. **Real-environment verification.** Real Microsoft consent, uploads, downloads and **real interrupted operations** (kill the server mid-upload / mid-replace /
   mid-delete) have not been exercised against the real OneDrive. Do this with `CENTRAL_RECOVERY_ENABLED=false` first (use the page's "Retry now" on a test file),
   and only then enable the worker.
2. **No per-user storage quota or bytes-per-day limit.** Rate limits cap how often a user may upload, not how much. The OneDrive account quota is the only ceiling.
3. **Orphaned OneDrive items are flagged, never deleted automatically.** The administrator removes them in OneDrive and then marks the file reviewed.
4. **Encryption-key rotation** (central and session) is versioned in the data but the procedure has not been rehearsed.
5. **No alerting.** The recovery page shows what needs attention, but nothing notifies anyone; a pager/e-mail on "needs review" > 0 is a sensible next step.
6. **Admin Storage does not show the recovery counts** (only a link); a badge on the link would make a growing review queue visible.
