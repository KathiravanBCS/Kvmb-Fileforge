import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Deliberately no `migrations` block: the database schema is owned by
// fileforge_full_schema_v1_1.sql, never by Prisma migrations.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
