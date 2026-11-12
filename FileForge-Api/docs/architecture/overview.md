# FileForge API: architecture

NestJS 11 (Express), TypeScript strict, Prisma 7 (client and Migrate: owns the schema), PostgreSQL, Microsoft Entra ID / Graph. Modelled on the `vstn-campaign` project's
layout and conventions (config via `@nestjs/config`, `nestjs-pino`, `PrismaService` with `pg` + `PrismaPg`, BigInt interceptor, Jest, Prettier/ESLint).

## Layout

```text
src/
├── main.ts                 bootstrap (env is validated first; the API refuses to start on bad config)
├── app.setup.ts            HTTP setup shared with tests: /api/v1 prefix, CORS, session middleware, Swagger (dev), trust proxy
├── app.swagger.ts          Swagger UI + OpenAPI document (development only)
├── app.module.ts           ConfigModule, LoggerModule (pino), global filter + BigInt interceptor, feature modules
├── app.controller.ts       existing GET /api/v1/health/live (now @Public)
├── app.services.ts         existing health service (file name kept as it was)
├── config/                 app / auth / database config + Zod env validation
├── common/
│   ├── constants/  decorators/  exceptions/  filters/  interceptors/  middleware/  types/  utils/
├── prisma/                 PrismaModule (global) + PrismaService
├── modules/
│   ├── auth/               controllers, services (Microsoft login, session), guards (authenticated, CSRF), dto, interfaces
│   ├── microsoft/          identity (MSAL sign-in + silent tokens), graph (delegated Graph client), shared errors
│   ├── users/              identity provisioning
│   ├── storage/onedrive/   OneDrive connection (Connect, status), file operations, path/name validation, controller
│   └── workspaces/         workspace list, membership lookup + workspace/role guard
└── testing/                fake test environment (no real credentials)
prisma/schema.prisma        PARTIAL (identity tables); generated client goes to generated/prisma
docs/                       this documentation
```

Directories from the target tree that have no code yet (`roles`, `permissions`, `storage`, `files`, business modules, `.github`, `.deployment`,
`AGENTS.md`) were deliberately **not** created. `bigint.interceptor.ts` lives in `common/interceptors/` (as in the reference project), not `src/`.

## Request pipeline

`CORS (one origin, credentials)` → `express-session (cookie → server session)` → `pino-http (request id)` → global guards
(`AuthenticatedGuard` → `CsrfGuard`) → route handler → `BigIntInterceptor` → `HttpExceptionFilter` (uniform error envelope).

All routes live under the global prefix `/api/v1` (`common/constants/api.constants.ts`). In development, Swagger UI is at
`/api/v1/docs` (`app.swagger.ts`); it is not served in production.

## Module boundaries

- `auth` depends on `microsoft`, `users` and `storage` (the one Microsoft redirect also completes Connect OneDrive); `storage` depends on `microsoft` and `workspaces`; `microsoft` depends on nothing above it (no cycles).
- `microsoft/identity` owns everything MSAL: authorization URL, code exchange, ID-token claim checks, silent token renewal. The per-session token cache is passed in as a `TokenCacheStore`, so this module knows nothing about Express sessions.
- `microsoft/graph` is only the reusable building block for Phase 1E (token + request + error mapping). It has no OneDrive operations.
- `workspaces` provides `WorkspaceAccessGuard` + `@WorkspaceRoles()`: membership and role *code* come from the database, per workspace. There is no global admin role.

## Decisions

| Decision | Why |
|---|---|
| BFF, tokens server-side only | The browser never holds Microsoft tokens |
| `express-session` MemoryStore | Phase 1D scope; **development only** (see `docs/authentication/microsoft-bff-auth.md`) |
| Default-deny global guard + `@Public()` | New routes are protected unless explicitly opened |
| Global CSRF guard | Future mutation endpoints are protected automatically |
| Identity key `(provider, issuer, oid)` | Never email; see `docs/database/identity-provisioning.md` |
| Lazy DB connection | The API boots without the database; login then fails closed |
| Express, not Fastify | Matches the FileForge guide and `express-session` (the reference project uses Fastify) |
| `rejectUnauthorized: false` **not** copied | The reference disables certificate checks for Azure PostgreSQL; here TLS follows `DATABASE_URL` |

## Commands

```bash
npm run build      # prisma generate + nest build (output: dist/src/main.js)
npm test           # prisma generate + jest
npm run lint       # eslint (type-aware) + prettier
npm run typecheck  # tsc --noEmit
npm run dev        # prisma generate + nest start --watch
```
