/** Folder at the TOP of the central OneDrive. A sibling of the personal File Manager's `FileForge`, never inside it. */
export const CENTRAL_ROOT_FOLDER_NAME = 'FileForge-Central';
/** Holds one folder per FileForge user id: `FileForge-Central/users/<userId>/<uuid>.<ext>`. */
export const CENTRAL_USERS_FOLDER_NAME = 'users';

/** Approved limit per file. This is an application limit; the OneDrive account has its own quota. */
export const CENTRAL_MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Up to this size a single request uploads the file; larger files use a Graph upload session. */
export const SIMPLE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
/** Upload session chunk size. Graph requires a multiple of 320 KiB: 16 x 320 KiB = 5 MiB. Bounds memory per upload. */
export const UPLOAD_CHUNK_BYTES = 16 * 320 * 1024;

/** Postgres advisory-lock key that serializes refreshing the central token cache across backend instances. */
export const CENTRAL_REFRESH_LOCK_KEY = 731_001;

/**
 * Postgres advisory-lock keys (all short-lived transaction locks; see the services that take them).
 *  - ADMISSION: serializes upload admission, so parallel requests on any instance cannot slip past a limit.
 *  - HOUSEKEEPING: lets exactly one instance run the periodic cleanup of expired slots and sessions.
 * The per-file RECOVERY lock is NOT an advisory lock: it is a lease token on the row itself (see central-recovery.service.ts),
 * because it must stay valid across a long Graph operation and a pooled connection cannot be trusted to hold one.
 */
export const CENTRAL_ADMISSION_LOCK_KEY = 731_002;
export const CENTRAL_HOUSEKEEPING_LOCK_KEY = 731_003;

/** Extra bytes a multipart body may add around the file itself (boundaries, headers), for the early size check. */
export const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

/** Graph retry policy for idempotent calls only (reads, deletes, chunk uploads with an explicit range). */
export const GRAPH_MAX_ATTEMPTS = 3;
export const GRAPH_RETRY_BASE_MS = 400;
export const GRAPH_RETRY_MAX_WAIT_MS = 10_000;

/** Lifecycle values of central_files.upload_status. */
export const FILE_STATUS = {
  pending: 'pending',
  uploading: 'uploading',
  ready: 'ready',
  replacing: 'replacing',
  failed: 'failed',
  deleting: 'deleting',
  deleted: 'deleted',
} as const;

/** A file can be listed, downloaded and previewed in these states (during a replace the old content is still intact). */
export const READABLE_STATUSES: string[] = [FILE_STATUS.ready, FILE_STATUS.replacing];

/** Entity-type codes (master.entity_types) used by events. */
export const ENTITY_CENTRAL_FILE = 'central_file';
export const ENTITY_CENTRAL_CONNECTION = 'central_storage_connection';

/** Page size limits for lists. */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
