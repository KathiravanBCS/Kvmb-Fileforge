# Prisma

The database schema is owned by `../docs/database/sql/fileforge_full_schema_v1_1.sql` (65 tables, 12 schemas) and is already
applied to `fileforge_db`. Prisma is used as a **query client only**.

- `schema.prisma` is the output of `prisma db pull` (read-only introspection of the live database), restricted to the
  `core`, `storage` and `master` schemas. Add more schemas to `datasource.schemas` and re-pull when a phase needs them.
- Read the caveats at the top of the file before using the client: partial unique indexes appear as `@unique`/`@@unique`
  with `where: raw(...)`, so use `findFirst` with explicit `is_deleted: false` filters instead of `findUnique` on them.

**Never run** `prisma migrate`, `prisma db push` or any reset against `fileforge_db`.

Useful commands (none of them writes to the database):

```bash
npm run db:validate   # prisma validate
npm run db:generate   # prisma generate -> generated/prisma
# refresh the models from the live database WITHOUT overwriting the file (review the diff first):
npx prisma db pull --print --schema <a copy of schema.prisma with the schemas you want> > pulled.prisma
```
