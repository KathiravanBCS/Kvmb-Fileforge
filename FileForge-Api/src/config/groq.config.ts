import { registerAs } from '@nestjs/config';

import { validateEnv } from './env.validation';

// The API key is a secret: never log it. Missing key = scanning is switched off (503), the rest of the API is unaffected.
export default registerAs('groq', () => {
  const env = validateEnv(process.env);
  return {
    apiKey: env.GROQ_API_KEY ?? null,
    model: env.GROQ_MODEL,
  };
});
