import { z } from 'zod';

const envSchema = z.object({
  // z.url() alone accepts "localhost:4000" (scheme "localhost:"), which breaks every request URL.
  VITE_API_BASE_URL: z.url({ protocol: /^https?$/ }),
});

const parsed = envSchema.safeParse(import.meta.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
  throw new Error(`Invalid environment configuration. Copy .env.example to .env and fix:\n${details}`);
}

export const env = parsed.data;
