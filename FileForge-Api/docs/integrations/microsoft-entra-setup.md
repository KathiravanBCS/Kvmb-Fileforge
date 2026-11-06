# Microsoft Entra ID setup for backend sign-in

The existing **FileForge AI** registration was created for a browser (SPA) app. The backend is a *confidential client*, so two things are needed
that did not exist before. Nothing here is automated: it has to be done in the Azure Portal by someone who owns the registration.

## 1. Add a Web redirect URI

1. Azure Portal → **Microsoft Entra ID** → **App registrations** → **FileForge AI**.
2. **Authentication** → **Add a platform** → **Web**.
3. Redirect URI: `http://localhost:4000/api/v1/auth/microsoft/callback` → **Configure**.
4. Under **Implicit grant and hybrid flows**, leave **both boxes unchecked** (the code flow does not use them).
5. The old SPA entry `http://localhost:3000` is no longer used by the backend flow. It can be removed once nothing else uses it.
6. For deployed environments add one Web redirect URI per environment (`https://<api-host>/api/v1/auth/microsoft/callback`) and set `MICROSOFT_REDIRECT_URI` to match **exactly**.

## 2. Create a client secret

1. **Certificates & secrets** → **Client secrets** → **New client secret**. Pick a description and an expiry.
2. **Copy the *Value* immediately** (it is shown once; the *Secret ID* is not the secret).
3. Put it in `FileForge-Api/.env` as `MICROSOFT_CLIENT_SECRET=…`. `.env` is git-ignored. Never put it in `FileForge-WebUi`, a commit, a chat or a log.
4. Note the expiry date and rotate before it: sign-in stops working when the secret expires.

## 3. Check the rest of the registration

- **Overview** → copy **Application (client) ID** into `MICROSOFT_CLIENT_ID`.
- **Authentication** → **Supported account types** must allow both organizational and personal accounts ("Accounts in any organizational directory and personal Microsoft accounts"). This is what makes the `common` authority work.
- **API permissions** (delegated, Microsoft Graph): `User.Read`, `offline_access`, `Files.ReadWrite`, `Mail.Read`, `Mail.Send`. Sign-in itself only asks for `openid profile email offline_access User.Read`; the others are requested when their feature needs them.
- Granting consent in Graph Explorer does **not** authorize this app. Each user consents to *FileForge AI* on first use.

## 4. Generate the session secret

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Use the output as `SESSION_SECRET` (keep it stable between restarts; changing it invalidates all sessions).

## 5. First real sign-in checklist

Performed successfully on 2026-11-04 with a personal Microsoft account (the user landed on the dashboard and the database rows were verified).
To repeat it, you need the items above plus `DATABASE_URL`:

1. `npm run dev` in `FileForge-Api` and `FileForge-WebUi`.
2. Open `http://localhost:3000` → **Sign in with Microsoft** → choose the account → approve consent.
3. You should land on the dashboard; `GET http://localhost:4000/api/v1/auth/me` (same browser) returns your `{ id, displayName, email }`.
4. If you land on `/?auth_error=<code>` check the API log line `auth_login_failed`: it has the `reason`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| API refuses to start: `MICROSOFT_REDIRECT_URI: must end with /api/v1/auth/microsoft/callback` | An older `.env` still has the unprefixed `/auth/microsoft/callback` path; update it (and the Entra Web redirect URI) |
| Microsoft error `AADSTS50011` (reply URL mismatch) | `MICROSOFT_REDIRECT_URI` differs from the registered Web redirect URI |
| `AADSTS7000215` / `invalid_client` | Wrong or expired client secret, or the *Secret ID* was copied instead of the *Value* |
| `AADSTS700016` | Wrong `MICROSOFT_CLIENT_ID` |
| `auth_error=account_unavailable` | See `docs/database/identity-provisioning.md` (email already used, owner role missing, account disabled) |
| `auth_error=service_unavailable` | Database unreachable or session could not be saved: check `DATABASE_URL` / `sslmode=require` |
| Signed out after every API restart | Expected: sessions are in memory (development only) |
