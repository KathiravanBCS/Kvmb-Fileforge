# FileForge API — backend development guide

Updated: 3 November 2026

## 1. Technology and scope

The backend will use **NestJS, TypeScript, Prisma ORM, PostgreSQL, and Swagger**. NestJS replaces the earlier Fastify recommendation to follow your reference folder structure. This guide uses Nest's default Express adapter.

This document is a plan for you to implement. Commands, source files, configuration, and generated output shown here are instructions for future work. Updating this guide does not install dependencies or create the application.

| Technology | Purpose |
| --- | --- |
| TypeScript | Backend programming language and compile-time type checking |
| Node.js | Runtime that executes the compiled backend |
| NestJS | Modules, controllers, dependency injection, and HTTP application structure |
| Prisma ORM | Typed database queries and schema migration tools |
| PostgreSQL | Relational database |
| OpenAPI | Machine-readable API contract |
| Swagger UI | Browser interface for viewing and testing endpoints |

FileForge's business requirements are still open. The example modules below are provisional; confirm the actual product features before implementing them.

## 2. Target folder structure

Follow this layout, matching the organization in your screenshot:

```text
FileForge-Api/
├── .github/
│   └── workflows/
├── dist/                              # Build output — generated
├── docs/
│   ├── architecture.md
│   ├── database.md
│   └── api-conventions.md
├── generated/
│   └── prisma/                        # Prisma Client — generated
├── node_modules/                      # Dependencies — generated
├── prisma/
│   ├── migrations/
│   └── schema.prisma
├── src/
│   ├── common/
│   │   ├── decorators/
│   │   ├── dto/
│   │   ├── filters/
│   │   ├── guards/
│   │   ├── interceptors/
│   │   └── pipes/
│   ├── modules/
│   │   ├── health/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── folders/
│   │   └── files/
│   ├── prisma/
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts
│   ├── app.controller.ts
│   ├── app.module.ts
│   ├── app.service.ts
│   ├── bigint.interceptor.ts          # Optional; add only if required
│   └── main.ts
├── test/
│   ├── app.e2e-spec.ts
│   └── jest-e2e.json
├── .env                               # Local secrets — ignored by Git
├── .env.example
├── .gitignore
├── .prettierrc
├── eslint.config.mjs
├── nest-cli.json
├── package.json
├── package-lock.json
├── prisma.config.ts
├── tsconfig.json
├── tsconfig.build.json
├── README.md
└── BACKEND-DEVELOPMENT-GUIDE.md
```

This is the target tree, not a list of files already implemented. Create source folders when their features are needed. `dist`, `node_modules`, and the generated client appear after running build, installation, and generation commands.

The screenshot also contains `AGENTS.md`, `CLAUDE.md`, and `.deployment`. Those are optional assistant or hosting-specific files, not Nest requirements. Add them only when there is an actual instruction or deployment need.

## 3. What belongs in each location

| Location | Responsibility |
| --- | --- |
| `.github/workflows/` | CI workflows for checking, testing, and building the application |
| `docs/` | Architecture decisions, database design, and API conventions |
| `generated/prisma/` | Machine-generated Prisma Client; never edit manually |
| `prisma/schema.prisma` | Models, relations, indexes, and client generator |
| `prisma/migrations/` | Reviewed database migration history committed to Git |
| `src/common/` | Shared HTTP infrastructure used by multiple features |
| `src/modules/` | Business features organized by module |
| `src/prisma/` | Nest module and injectable service for database access |
| `src/app.module.ts` | Root module that composes application dependencies |
| `src/app.controller.ts` | Root HTTP endpoints; keep feature endpoints in their modules |
| `src/app.service.ts` | Root application service; avoid collecting all business logic here |
| `src/main.ts` | Bootstrap, validation, Swagger, global prefix, and shutdown hooks |
| `test/` | End-to-end test setup and cross-module scenarios |
| `prisma.config.ts` | Prisma CLI configuration and migration connection URL |

The two Prisma folders have different jobs: root `prisma/` describes the database; `src/prisma/` integrates Prisma into Nest. Root `generated/` holds code produced from the schema.

`bigint.interceptor.ts` is optional. If an API returns PostgreSQL BigInt values, serialize them deliberately as decimal strings. Converting arbitrary BigInt values to Number can lose precision. The UUID example in this guide does not require that interceptor.

## 4. Feature module structure

For a confirmed folders feature:

```text
src/modules/folders/
├── dto/
│   ├── create-folder.dto.ts
│   ├── update-folder.dto.ts
│   ├── list-folders-query.dto.ts
│   └── folder-response.dto.ts
├── folders.controller.ts
├── folders.service.ts
├── folders.module.ts
└── folders.service.spec.ts
```

- **Controller:** HTTP routes, DTO input, response status, and Swagger endpoint metadata.
- **Service:** Business rules and database operations through PrismaService.
- **Module:** Registers the controller and service and imports required modules.
- **DTO:** Runtime validation rules and documented request/response fields.
- **Tests:** Meaningful business and failure cases; avoid tests that merely repeat implementation details.

Typical request flow:

```text
Client → Nest guards and validation → Controller → Service → PrismaService → PostgreSQL
```

Do not put database queries in controllers. Export providers only when another module needs them. Avoid a separate repository wrapper for every trivial Prisma query; introduce one when it solves actual complexity.

## 5. Tooling and dependency setup

Use a supported patched Node.js 24 LTS release, at least 24.15 for the currently documented Nest scaffolding tools. Use a supported patched PostgreSQL 17 installation. This guide selects Nest 11 and Prisma 7 as explicit major baselines rather than claiming they are the newest majors.

Check your tools:

```powershell
node --version
npm --version
psql --version
```

When you are ready to write the project, initialize manually in the API folder so you can understand each file:

```powershell
Set-Location -LiteralPath 'D:\2026 Deployements\KVMB-FileForge\FileForge-Api'
npm init -y
npm pkg set type=commonjs
npm install @nestjs/common@11 @nestjs/core@11 @nestjs/platform-express@11
npm install @nestjs/config@4 @nestjs/swagger@11 reflect-metadata rxjs
npm install class-validator class-transformer dotenv
npm install @prisma/client@7 @prisma/adapter-pg@7 pg
npm install --save-dev @nestjs/cli@11 @nestjs/schematics@11 @nestjs/testing@11
npm install --save-dev typescript@~5.9.0 @types/node@24 @types/express @types/pg prisma@7
```

Align Nest core package versions and check Swagger peer dependencies. Keep Prisma CLI, client, and adapter on the same exact resolved release. Commit `package-lock.json`; fresh installs in CI use `npm ci`.

**Checkpoint:** Dependencies resolve successfully and `package.json` declares CommonJS. Do not mix the earlier Fastify/ESM examples with this baseline.

## 6. TypeScript, Nest configuration, and scripts

Example `tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "target": "ES2023",
    "rootDir": ".",
    "outDir": "./dist",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "strict": true,
    "strictPropertyInitialization": false,
    "skipLibCheck": true,
    "sourceMap": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "generated/**/*.ts"],
  "exclude": ["node_modules", "dist", "test", "**/*.spec.ts"]
}
```

Because generated TypeScript is outside `src`, `rootDir` is the API root. The compiled entry is consequently `dist/src/main.js`; the compiled client goes into `dist/generated/prisma`. Preserve both when packaging the application. Use extensionless relative imports for this CommonJS baseline.

Example `tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "test", "**/*.spec.ts"]
}
```

Example `nest-cli.json`:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true }
}
```

Add the following entries inside the `scripts` object in `package.json`, preserving the rest of the package:

```json
{
  "start": "nest start",
  "start:dev": "nest start --watch",
  "build": "nest build",
  "start:prod": "node dist/src/main.js",
  "typecheck": "tsc --noEmit",
  "db:validate": "prisma validate",
  "db:generate": "prisma generate",
  "db:migrate": "prisma migrate dev",
  "db:deploy": "prisma migrate deploy",
  "db:studio": "prisma studio"
}
```

Configure ESLint, Prettier, and the chosen test runner in a separate tooling step. Empty configuration files do not enable those tools. Test configuration needs its own TypeScript/Jest settings because application compilation excludes tests.

## 7. PostgreSQL and environment configuration

Execute each statement as your local PostgreSQL administrator outside a transaction:

```sql
CREATE ROLE fileforge_dev WITH LOGIN CREATEDB PASSWORD 'replace_with_local_password';
CREATE DATABASE fileforge_dev OWNER fileforge_dev;
```

Local development `CREATEDB` allows Prisma to create its temporary shadow database. Production should separate migration permissions from a restricted application role.

Example `.env.example`:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=4000
DATABASE_URL="postgresql://fileforge_dev:replace_with_local_password@localhost:5432/fileforge_dev"
```

Copy it to `.env` and insert actual local credentials. Percent-encode special characters in URL passwords. Do not log the database URL or commit `.env`.

Use ConfigModule to load configuration and a validation function to require a PostgreSQL URL, check port bounds, and restrict NODE_ENV to known values. Fail startup with a clear message when configuration is missing.

Example `.gitignore`:

```gitignore
node_modules/
dist/
generated/prisma/
.env
.env.*
!.env.example
coverage/
*.log
```

**Checkpoint:** The development account can connect to the intended local database.

## 8. Prisma configuration and database integration

Root `prisma.config.ts`:

```typescript
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
```

`prisma/schema.prisma`:

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../generated/prisma"
  moduleFormat = "cjs"
}

datasource db {
  provider = "postgresql"
}
```

Prisma 7 uses a driver adapter at runtime; configuring the CLI URL alone does not configure your service. Generate the CommonJS client explicitly to match this guide.

For an optional local learning exercise, add:

```prisma
model Folder {
  id        String   @id @default(uuid()) @db.Uuid
  name      String   @db.VarChar(120)
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @db.Timestamptz(3)
}
```

This example has no ownership or permissions and is not a complete enterprise data model.

```powershell
npx prisma format
npm run db:validate
npm run db:migrate -- --name init_folders
npm run db:generate
```

Review the migration SQL and commit migrations. Regenerate the client after schema changes.

Implement `src/prisma/prisma.service.ts` as an injectable service that extends PrismaClient imported from `../../generated/prisma/client`. Obtain the validated URL from ConfigService, create a PrismaPg adapter, and pass it to `super({ adapter })`. Connect in `onModuleInit` and disconnect in `onModuleDestroy`.

`PrismaModule` provides and exports PrismaService. Feature modules import PrismaModule. Ensure ConfigModule is available where ConfigService is injected. Share one PrismaService per application context, not one client per request. Enable application shutdown hooks so termination closes connections.

**Checkpoint:** Migrations, generation, database connection, and shutdown work before writing business queries.

## 9. First Nest endpoint and Swagger

Write the root files in this order:

1. `app.service.ts`: injectable AppService with a health method returning `{ status: 'ok' }`.
2. `app.controller.ts`: controller exposing `GET health/live` and calling AppService.
3. `app.module.ts`: register AppController and AppService and import configuration.
4. `main.ts`: create the app, configure validation and Swagger, and start listening.

In bootstrap:

- Set the global prefix to `api/v1`.
- Use a global ValidationPipe with `whitelist: true`, `forbidNonWhitelisted: true`, and `transform: true`.
- Explicitly validate conversions and bounds for numeric query parameters.
- Enable shutdown hooks.
- Use the validated port and host.
- Handle startup failure and return a nonzero process exit status.

Enable Swagger in development with `DocumentBuilder`, `SwaggerModule.createDocument`, and `SwaggerModule.setup('docs', app, document)`. Use DTO classes with validation decorators and Swagger properties. TypeScript interfaces do not provide runtime validation. Document both success and failure responses.

```powershell
npm run typecheck
npm run start:dev
```

Open `http://127.0.0.1:4000/docs` and test:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:4000/api/v1/health/live'
```

Expected JSON: `{"status":"ok"}`. Liveness should not query the database. Add a separate readiness endpoint that returns 503 when required dependencies are unavailable, using bounded timeouts.

**Checkpoint:** Health works through Swagger and PowerShell, and Ctrl+C closes the application.

## 10. First complete database feature

Implement only a confirmed business resource. For the folder exercise:

| Endpoint under `/api/v1` | Success | Failure examples |
| --- | --- | --- |
| `POST /folders` | 201, created folder | 400 invalid name |
| `GET /folders` | 200, bounded page | 400 invalid pagination |
| `GET /folders/:id` | 200, selected fields | 400 invalid UUID; 404 absent |
| `PATCH /folders/:id` | 200, updated folder | 400 invalid body; 404 absent |
| `DELETE /folders/:id` | 204, empty body | 404 absent; 409 when a business rule blocks deletion |

Write DTOs, then service methods, controller routes, and module registration. Use ParseUUIDPipe for UUID parameters. Trim names and validate 1–120 characters after normalization. Construct allowed Prisma fields explicitly rather than spreading incoming bodies into queries.

Bound list size and use deterministic ordering, such as creation time plus ID. Define name uniqueness and hierarchy rules before adding constraints. Map database uniqueness conflicts to 409 and missing records to 404. Return generic messages for unexpected failures and log details internally with a request ID.

Suggested error envelope:

```json
{
  "error": {
    "code": "FOLDER_NOT_FOUND",
    "message": "The requested folder was not found.",
    "requestId": "request-correlation-id"
  }
}
```

Use a shared exception filter to keep validation, authorization, business, and unexpected errors consistent. Never expose raw SQL, credentials, Prisma internals, or stack traces.

## 11. Enterprise design stages

### Company boundaries and data modeling

Confirm whether this serves one company or multiple companies before expanding the schema. A proposed multi-company file system may need Organization, User, Membership, Folder, File, FileVersion, and AuditEvent records.

Derive organization access from verified membership. Scope reads, writes, counts, searches, and background jobs consistently. Enforce that parent folders and child resources belong to the same organization. Add cross-organization authorization tests. Design indexes from actual filters and ordering.

Use database transactions for related writes. External storage operations need compensation or an outbox workflow because a database transaction cannot roll back an uploaded object.

### Authentication and authorization

Choose an identity approach before implementing passwords or tokens. Consider an existing OIDC provider for enterprise identity. Implement route guards and resource access checks. Test anonymous, permitted, forbidden, expired-session, and cross-company requests.

A bearer scheme in Swagger documents authentication and lets the UI send credentials; it does not protect controllers. Implement the guards separately. Choose session revocation, key rotation, browser cookie/CSRF policy, and CORS configuration deliberately.

### File handling, if required

Store metadata in PostgreSQL and file contents in an appropriate storage system. Define size limits, quotas, allowed formats, scan requirements, and retention first. Use server-generated storage keys, authorize every download, validate content, and avoid buffering arbitrary uploads into memory.

Track upload completion and scan status. Plan retries, interrupted uploads, orphan cleanup, versioning, and coordinated deletion. Do not make storage objects public by default.

### Auditing and operations

Record significant business actions with actor, organization, resource, time, and request ID. Establish retention and access rules. Add structured logs, dependency readiness checks, metrics, alerts, and verified database backups.

## 12. Testing and acceptance criteria

Use Nest TestingModule for provider and controller integration and Supertest for HTTP end-to-end tests. Add Jest or another chosen runner and its configuration during the testing stage; the dependency commands above do not install a complete test runner.

Use a dedicated PostgreSQL test database. Load its configuration before creating the Nest application. Never run reset or cleanup operations against production. Close application and database connections after tests.

Verify meaningful behavior:

- A valid create request writes exactly one record and returns 201.
- Invalid or unknown input returns 400 and writes nothing.
- Invalid UUIDs return 400; absent valid IDs return 404.
- Lists have bounded size and stable ordering.
- Created data survives restarting the API.
- Errors match the documented envelope without exposing internals.
- Unauthorized and cross-company access fails consistently.
- Swagger reflects actual responses and validation expectations.
- Type checking, tests, and the compiled application pass.

## 13. Database changes and deployment

Development schema workflow:

```powershell
npx prisma format
npm run db:validate
npm run db:migrate -- --name describe_the_change
npm run db:generate
npm run typecheck
npm run build
```

Run the configured test suite. Review and commit schema changes, migrations, application code, tests, and the lockfile together.

In CI, install from the lockfile, generate Prisma Client, build, and test. Keep required runtime dependencies and the complete compiled `dist` tree. If pruning development dependencies, make the Prisma CLI available separately to the migration job.

Apply committed migrations once through a controlled deployment step:

```powershell
npm run db:deploy
```

Start the compiled application:

```powershell
npm run start:prod
```

Use backward-compatible migrations when application versions overlap. Do not use development reset commands as a release procedure. Rehearse backup restoration before relying on it.

Configure TLS, secrets, database network restrictions, connection pooling, request limits, trusted proxies, and explicit browser origins for the actual hosting environment. Use `HOST=0.0.0.0` in a container when needed. Protect production Swagger access or disable both its UI and raw contract endpoints by omitting setup.

## 14. Troubleshooting

| Symptom | Check |
| --- | --- |
| PowerShell blocks npm script execution | Try `npm.cmd` without weakening machine-wide execution policy |
| Database connection refused | PostgreSQL service, hostname, port, and network access |
| Authentication failed | Role, password, and URL encoding |
| Missing DATABASE_URL | Correct working directory and configuration loading |
| Shadow database permission error | Local CREATEDB permission or explicit shadow database setup |
| Generated client missing | Generator output and `npm run db:generate` |
| Prisma module-format error | Explicit `moduleFormat = "cjs"` and CommonJS TypeScript settings |
| Nest cannot resolve a provider | Module imports, provider registration, and exports |
| Swagger has missing fields | DTO classes, property metadata, and response decorators |
| Compiled entry not found | Root-level generated code produces `dist/src/main.js` with this configuration |
| Address already in use | Existing process on the API port or an alternate configured port |

## 15. Implementation order

1. Verify tools and confirm the NestJS project layout above.
2. Initialize dependencies and write configuration files.
3. Write the root module, service, controller, and bootstrap.
4. Enable Swagger and validate the health endpoint.
5. Configure PostgreSQL and implement PrismaModule and PrismaService.
6. Confirm the first business resource and write its migration.
7. Build one complete feature and meaningful tests.
8. Establish company boundaries, identity, and authorization before exposing business data.
9. Add confirmed file workflows and auditing.
10. Complete deployment, monitoring, backups, and recovery testing.

## 16. Official references

- [Nest CLI and standard project structure](https://docs.nestjs.com/cli/overview)
- [Nest Swagger setup](https://docs.nestjs.com/openapi/introduction)
- [Nest Prisma integration and module formats](https://docs.nestjs.com/recipes/prisma)
- [Prisma and NestJS guide](https://www.prisma.io/docs/guides/v7/frameworks/nestjs)
- [Prisma PostgreSQL connector](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql)
- [Node.js releases](https://nodejs.org/en/about/previous-releases)
- [PostgreSQL role privileges](https://www.postgresql.org/docs/current/sql-createrole.html)
