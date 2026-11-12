import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma Migrate owns the schema: prisma/schema.prisma + prisma/migrations (next to the schema, the default location).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
