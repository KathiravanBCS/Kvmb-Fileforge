# Retired: do not run these files

These SQL files built the old 12-schema layout (`core`, `storage`, `audit`, `master`, `contact`, ...). They are kept for history
only. **Prisma Migrate now owns the schema**, with two PostgreSQL schemas, `public` and `master`:
see [`../../../prisma/README.md`](../../../prisma/README.md) and `prisma/migrations/`.

Running any file here against `fileforge_db` recreates the retired layout and breaks the API.
