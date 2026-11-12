# Microsoft sign-in (Backend-for-Frontend)

React never sees a Microsoft token. NestJS signs the user in with Microsoft Entra ID, keeps the tokens in a
server-side session, and gives the browser only an opaque, `HttpOnly` session cookie.

```text
React (localhost:3000) ──cookie──▶ NestJS (localhost:4000) ──OIDC code flow + PKCE──▶ Microsoft Entra ID
                                        │  ├─ session store (in memory, DEV ONLY): user + Microsoft token cache
                                        │  └─ PostgreSQL fileforge_db: users / user_identities / workspaces
                                        └──delegated tokens──▶ Microsoft Graph (later phases)
```

## Endpoints

Every route is served under the global prefix **`/api/v1`** (set in `src/app.setup.ts`, constant `API_PREFIX`). The old unprefixed paths return `404`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/auth/microsoft/login` | public | Starts sign-in. `302` to Microsoft. Browser navigation, not `fetch`. |
| GET | `/api/v1/auth/microsoft/callback` | public | Microsoft redirects here. Always ends in `302` to the frontend. |
| GET | `/api/v1/auth/me` | session | `200 { id, displayName, email }` or `401`. |
| GET | `/api/v1/auth/csrf` | session | `200 { csrfToken }` or `401`. |
| POST | `/api/v1/auth/logout` | session + CSRF | `204`, session destroyed, cookie cleared. |
| GET | `/api/v1/health/live` | public | Existing liveness check. |

`/api/v1/auth/me` response (BIGINT ids are decimal **strings**; `displayName` is nullable; no tokens, no global roles):

```json
{ "id": "123", "displayName": null, "email": "person@example.com" }
```

Every other route requires a session by default (global guard). Opt out with `@Public()`.

## Sign-in flow

1. The browser navigates to `GET /api/v1/auth/microsoft/login`.
2. NestJS creates `state`, `nonce` and a PKCE verifier/challenge (S256), stores them in the visitor's session (single use, 10 minute lifetime, at most 5 pending), and redirects to Microsoft. The anonymous session lives only 10 minutes.
3. Microsoft authenticates the user (`prompt=select_account`) and redirects to `/api/v1/auth/microsoft/callback?code=…&state=…`.
4. NestJS removes the pending login for that `state` (so a replay finds nothing), then exchanges the code (confidential client secret + PKCE verifier) at Microsoft's token endpoint.
5. The ID token is checked: `aud` = our client id, `iss` = `<authority host>/<tid>/v2.0`, `nonce` = ours, `exp` not passed, `oid`/`sub`/`tid` present. MSAL also enforces the nonce. (MSAL does not verify the ID token signature; that is allowed for the code flow because the token arrives straight from the token endpoint over TLS, OIDC Core 3.1.3.7.)
6. The user is resolved or created in PostgreSQL (see `docs/database/identity-provisioning.md`).
7. The session is **regenerated** (new id, so a pre-login id is useless), filled with `{ user, csrfToken, Microsoft token cache }`, saved, and the browser is redirected to `FRONTEND_URL/`.

If anything fails the browser is redirected to `FRONTEND_URL/?auth_error=<code>` and **no session is created**.

| `auth_error` | Meaning |
|---|---|
| `access_denied` | The user cancelled at Microsoft |
| `consent_required` | Permission was not granted |
| `session_expired` | Unknown/expired/replayed `state` (also: no cookie, different browser) |
| `login_failed` | Token exchange or ID token validation failed, or bad callback parameters |
| `account_unavailable` | Account disabled, email already used by another identity, no email, or owner role missing |
| `service_unavailable` | Database or session store failed |

Codes are deliberately coarse; details go only to the server log.

## One redirect URI, two purposes

The callback `/api/v1/auth/microsoft/callback` serves **sign-in** and **Connect OneDrive** (`docs/integrations/onedrive-file-manager.md`). When a flow starts, the
server records its `purpose` (and, for Connect OneDrive, the workspace) next to the state/nonce/PKCE verifier in the visitor's own session; the browser cannot choose
or change it. The callback consumes that record (single use) and dispatches: sign-in establishes a session as above; Connect OneDrive completes the storage
connection and does **not** touch the session identity. Failures are tagged with their flow so the browser returns to `/?auth_error=<code>` or `/files?onedrive_error=<code>`.
The session also keeps the signed-in Microsoft account (`issuer` + `oid`): a later Microsoft flow must come back as that same account.

## Session cookie

`fileforge.sid` (`__Host-fileforge.sid` when `FRONTEND_URL` is https): `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` over https,
fixed lifetime `SESSION_TTL_MINUTES` (default 480; **not** sliding). Lax is required so the cookie survives the top-level redirect back from
Microsoft, while blocking cross-site POSTs. `localhost:3000` and `localhost:4000` are the same *site*, so the cookie is sent with the app's requests.

## CSRF contract

Synchronizer-token pattern, enforced by a **global** guard on every method except `GET`, `HEAD`, `OPTIONS`:

1. `GET /api/v1/auth/csrf` (signed in) → `{ "csrfToken": "<43 chars>" }`. Stable for the session; fresh after each sign-in.
2. Send it on every state-changing request as the header **`X-CSRF-Token: <csrfToken>`**, together with the cookie (`withCredentials: true`).
3. Failures: `403 CSRF_TOKEN_INVALID` (missing/wrong token), `403 CSRF_ORIGIN_MISMATCH` (an `Origin` header other than `FRONTEND_URL`).

The frontend fetches the token on demand for logout and does not store it.

CORS allows exactly one origin (`FRONTEND_URL`) with credentials, methods `GET POST PUT PATCH DELETE OPTIONS`, headers `Content-Type, Accept, X-CSRF-Token`. Never `*`.

## Error envelope

```json
{ "error": { "code": "UNAUTHENTICATED", "message": "Authentication required.", "requestId": "…uuid…" } }
```

Unexpected errors become `500 INTERNAL_ERROR` with a generic message. `requestId` matches the server log line.

## Where tokens live

| Item | Location |
|---|---|
| Microsoft access/refresh tokens | Serialized MSAL cache inside the **server-side session** (`session.msalCache`). Never sent to the browser, never in PostgreSQL, never logged. |
| Session id | `HttpOnly` cookie (opaque, signed) |
| CSRF token | Server session; handed to the page on request |

**Limitation:** the session store is the in-memory `MemoryStore`. A restart or redeploy signs everyone out and discards the Microsoft refresh tokens
(`reauth_required` for Graph calls); it does not scale beyond one process. **Local development only.** Production needs a shared, encrypted store
(a later phase).

## Scopes

Sign-in requests only `openid profile email offline_access User.Read`. `Files.ReadWrite`, `Mail.Read` and `Mail.Send` are requested by the phase
that needs them (incremental consent). Consent given in Graph Explorer does not count for the FileForge app.

## Logging

`nestjs-pino`, JSON in production. Request logs contain only `id`, `method`, path **without query string**, and status. Cookies, authorization
headers, `code`, `state`, tokens, the client secret and `DATABASE_URL` are never logged. Auth failures log a short `code` + `reason` slug and the
error class name only.

## API documentation (Swagger)

Development only (not served when `NODE_ENV=production`): **`http://localhost:4000/api/v1/docs`**, OpenAPI JSON at `/api/v1/docs-json`.

- Swagger UI runs on the API origin, so the browser sends the session cookie. Sign in once through the React app, then *Try it out* works for GET endpoints such as `/api/v1/auth/me`.
- State-changing calls need `X-CSRF-Token` **and** the frontend origin. Swagger's origin is the API's, so the CSRF origin check answers `403 CSRF_ORIGIN_MISMATCH` for POSTs such as `/api/v1/auth/logout`. This is deliberate; CSRF protection is not loosened for Swagger.
- The page itself is public and contains no secrets or configuration values.

## Not yet covered

- Rate limiting on `/api/v1/auth/microsoft/login`.
- Signing out of Microsoft itself (logout is local: the FileForge session is destroyed).
- Re-checking `is_active` on every request (`/api/v1/auth/me` reads the session snapshot taken at sign-in).
- Microsoft Graph usage beyond the building blocks in `src/modules/microsoft/graph`.

## Environment variables

See `.env.example`. All are validated at start-up (names only are reported, never values).

| Variable | Required | Notes |
|---|---|---|
| `FRONTEND_URL` | yes | `http(s)://…` origin of the React app |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | yes | Entra app registration; secret is backend-only |
| `MICROSOFT_AUTHORITY` | no | default `https://login.microsoftonline.com/common` |
| `MICROSOFT_REDIRECT_URI` | yes | must equal the registered **Web** redirect URI; its path must be `/api/v1/auth/microsoft/callback` (checked at start-up) |
| `SESSION_SECRET` | yes | ≥ 32 random characters |
| `SESSION_TTL_MINUTES` | no | default 480 |
| `DATABASE_URL` | yes | `postgresql://…?sslmode=require` for Azure |
| `PORT`, `NODE_ENV`, `LOG_LEVEL`, `TRUST_PROXY` | no | `TRUST_PROXY=true` only behind a TLS-terminating proxy |
