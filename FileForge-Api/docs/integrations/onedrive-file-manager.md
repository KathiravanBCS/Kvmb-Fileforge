# File Manager and OneDrive (Phase 1E)

Server-side Microsoft Graph access to the user's OneDrive, behind the existing session, CSRF and workspace/role checks.
File **contents** live in OneDrive; only **metadata** goes to PostgreSQL (`files`). Microsoft tokens never leave the server.

## What is in OneDrive, and what the app can touch

Everything is rooted in one folder, **`FileForge`**, at the top of the user's OneDrive. Nothing outside it is read, listed or changed.

- The browser **never** sends or receives OneDrive ids. It sends a **path relative to the FileForge folder** (`invoices/2026/a.pdf`).
- The drive id and root-folder item id come from the stored connection (`connections.external_drive_id`, `root_folder_item_id`), never from the request.
- Every path is validated (`onedrive-paths.ts`): no `.`/`..`, no absolute or empty segments, no backslashes, none of OneDrive's forbidden characters, no control or
  bidirectional-override characters, no reserved names (`CON`, `AUX`, `~$…`, `desktop.ini`, `_vti_`…), max 255 per name, 400 total, depth 10. Segments are percent-encoded.
- Every item that is acted on must be in the connection's drive and must not be a shortcut (`remoteItem`); otherwise `403 ITEM_OUTSIDE_STORAGE_ROOT`. Shortcuts, notebooks and other-drive items are not listed.
- Folders are **browse-only**: files can be uploaded, downloaded, renamed and deleted; folders cannot be created, renamed or deleted, so the module folders cannot be removed through the app.

## Connect OneDrive (incremental consent)

Signing in only asks for `User.Read`. `Files.ReadWrite` is requested by a separate, explicit step:

1. `POST /api/v1/workspaces/:workspaceId/storage/onedrive/connect` (owner/admin, CSRF) → `{ url }`. The server records `purpose=connect_onedrive` and the workspace in the visitor's session (single use, 10 minutes) and builds a Microsoft URL for `openid profile email offline_access Files.ReadWrite` with `login_hint` = the signed-in user. The browser navigates to it.
2. Microsoft redirects to the **same** callback as sign-in (`/api/v1/auth/microsoft/callback`; no second redirect URI to register). The callback dispatches on the recorded purpose.
3. `completeConnect` re-checks everything after the Microsoft detour: a signed-in session, that the user is **still owner/admin** of that workspace (before the code is even exchanged), and that the consenting account is **the same Microsoft account** as the sign-in (issuer + `oid`). Tokens are obtained into a *staging* cache and merged into the session only after that check, so a different account's tokens never reach the session.
4. It finds or creates `FileForge` and the 8 module folders (only missing ones; never modifies or deletes anything), then writes the connection and folder mappings in one transaction.
5. The browser lands on `/files?onedrive=connected`, or `/files?onedrive_error=<code>`.

| `onedrive_error` | Meaning |
|---|---|
| `access_denied` | The user cancelled at Microsoft |
| `consent_required` | Permission was not granted |
| `session_expired` | No signed-in session, or the redirect was unknown/expired/replayed |
| `account_mismatch` | A different Microsoft account than the one signed in |
| `workspace_forbidden` | Not (or no longer) an owner/admin of the workspace |
| `onedrive_unavailable` | Folder setup in OneDrive failed |
| `service_unavailable` / `login_failed` | Database/session failure, or the code exchange failed |

After this, a **new sign-in should need no extra click** (expected, not yet verified): consent is per user and app, not per session, so the refresh token from a plain sign-in should be able to mint a `Files.ReadWrite` token silently. The status would then only turn `consent_required` if the consent is revoked. If it shows "Permission needed" after a restart, click **Connect OneDrive** once more (no consent screen should appear) and report it.

## Endpoints (`/api/v1/workspaces/:workspaceId/storage/onedrive`)

Every route needs a session, membership of `:workspaceId`, and a role that may do it (`WorkspaceAccessGuard` + `@WorkspaceRoles`). State-changing routes also need `X-CSRF-Token`.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `` | owner, admin, editor, viewer | `{ status, connection }`; `status` ∈ `not_connected`, `connected`, `consent_required`, `reauth_required`, `owned_by_other_user`, `error`. Checks tokens, does not call Graph. |
| POST | `/connect` | owner, admin | `{ url }` |
| GET | `/items?path=` | all | Folder listing, folders first; follows next-page links; flags `truncated` at 1000 |
| POST | `/files` | owner, admin, editor | multipart `file` + `path` (target folder, must exist). Max **4 MB**. Never overwrites (`409 FILE_ALREADY_EXISTS`) |
| GET | `/files/content?path=` | all | Streamed through the API as an attachment (`application/octet-stream`, `nosniff`, `no-store`); never inline |
| PATCH | `/files` | owner, admin, editor | `{ path, newName }`, same folder |
| DELETE | `/files?path=` | owner, admin | Moves the file to the OneDrive recycle bin |

Also `GET /api/v1/workspaces` (the caller's workspaces and roles; used to find the workspace id).

**Ownership.** A connection stores no tokens, so it only works for its owner, in a session of theirs that holds the tokens. Another workspace member gets `403 ONEDRIVE_CONNECTION_NOT_OWNED` / status `owned_by_other_user`; their OneDrive is never exposed to them.

## File rules

Size 1 byte to 4 MB (`MAX_UPLOAD_BYTES`; a deliberate app cap because uploads are buffered in memory, not Graph's limit). Names follow the path rules above. Blocked extensions (by the **final** extension, so `a.pdf.exe` is caught): `exe com bat cmd msi msp scr pif cpl dll sys lnk reg hta ps1 psm1 vbs vbe js jse wsf wsh jar sh apk`. The same rules are applied for rename targets. The frontend mirrors them for early feedback; the server is authoritative.

## Metadata (`files`) and consistency

OneDrive is the source of truth; every Graph/DB pair has a fixed order and a compensating step:

| Operation | Order | If the second step fails |
|---|---|---|
| Upload | OneDrive, then metadata | The new file is deleted again (it was created by this request, `conflictBehavior=fail`); `503 METADATA_WRITE_FAILED` |
| Rename | OneDrive, then metadata | The old name is restored; `503 METADATA_WRITE_FAILED` |
| Delete | metadata soft-delete (reversible), then OneDrive | The soft-delete is undone and the Graph error reported. A 404 from OneDrive counts as deleted. |

Rows are matched by `(workspace_id, connection_id, external_object_id)` with `is_deleted = false`, so a lookup can never cross workspaces or connections. A row is created or updated, never duplicated. Soft-delete sets `is_deleted`, `deleted_at`, `deleted_by`, `upload_status='deleted'` together (the table's CHECK requires `deleted_at` whenever `is_deleted`). `checksum_sha256` is computed from the uploaded bytes.

`connections`: `auth_mode='delegated'`, `connection_status`, `external_drive_id`, `root_folder_item_id`, `root_folder_path='FileForge'`, `consented_scopes` (as returned by Microsoft, including the OpenID scopes), `last_auth_at`, `last_verified_at`. **`secret_reference` stays NULL and `config` is `{}`**: no token is stored in PostgreSQL. `folder_mappings`: one row per module folder; `relative_path` is relative to the FileForge folder (the form the API accepts).

| Folder | `module_code` |
|---|---|
| business-cards | `business_card` |
| email-attachments | `email_attachments` |
| exports | `export` |
| invoices | `invoice` |
| pdf-documents | `pdf` |
| qr-scans | `qr` |
| receipts | `receipt` |
| reports | `reports` |

## Errors

All errors use the standard envelope `{ error: { code, message, requestId } }`. Microsoft failures are mapped to stable codes and generic messages (Graph bodies, file names and tokens are never forwarded):

| Graph | HTTP | `code` |
|---|---|---|
| no usable refresh token / token rejected after one renewal | 401 | `MICROSOFT_REAUTH_REQUIRED` |
| scope not consented | 403 | `ONEDRIVE_CONSENT_REQUIRED` |
| forbidden | 403 | `ONEDRIVE_FORBIDDEN` |
| not found | 404 | `ITEM_NOT_FOUND` |
| name exists | 409 | `FILE_ALREADY_EXISTS` |
| throttled | 429 | `ONEDRIVE_THROTTLED` |
| unavailable / network | 503 | `ONEDRIVE_UNAVAILABLE` |
| anything else | 502 | `ONEDRIVE_ERROR` |

Other codes: `INVALID_PATH`, `FILE_TYPE_NOT_ALLOWED`, `FILE_TOO_LARGE`, `EMPTY_FILE`, `FILE_REQUIRED`, `NOT_A_FILE`, `NOT_A_FOLDER`, `PAYLOAD_TOO_LARGE` (413, while receiving), `ONEDRIVE_NOT_CONNECTED` (404), `ONEDRIVE_CONNECTION_INVALID` (409), `WORKSPACE_ACCESS_DENIED`/`WORKSPACE_ROLE_FORBIDDEN` (403).

## Limitations

- Sessions (and the Microsoft tokens in them) are in memory: an API restart signs everyone out (see the auth doc).
- Uploads are limited to 4 MB; there are no upload sessions, resumable uploads or folder creation yet.
- Downloads are fully buffered in the browser (blob), which suits small and medium files.
- A single page of at most 1000 items per folder; no server-side pagination.
- Metadata is written for files changed **through FileForge**. Files added or changed directly in OneDrive appear in listings (live from Graph) but have no `files` row until they are renamed or otherwise touched through the app; there is no reconciliation job.
- Role checks use role *codes*; `permissions` is empty.
- Graph calls are not yet rate-limited by the app.

## Manual verification with a real account

The Connect step has been completed once against real Microsoft and the real database. Not yet exercised against real OneDrive: listing, upload, download, rename, delete. To do so:
restart the API and sign in again (the status should be `connected` without clicking Connect) → **File Manager** → browse the 8 folders → upload a small file into `invoices` → download it → rename it → delete it → check the recycle bin in OneDrive.
Read-only checks on the database afterwards: one `files` row per uploaded file (soft-deleted after the delete), and still no token-like text in `connections`.
