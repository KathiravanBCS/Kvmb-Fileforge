import { registerAs } from '@nestjs/config';

import { validateEnv } from './env.validation';

export default registerAs('app', () => {
  const env = validateEnv(process.env);
  const isProduction = env.NODE_ENV === 'production';
  // Only the origin is used: it is the single allowed CORS origin and the post-login redirect target.
  const frontendOrigin = new URL(env.FRONTEND_URL).origin;

  return {
    nodeEnv: env.NODE_ENV,
    isProduction,
    port: env.PORT,
    logLevel: env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
    trustProxy: env.TRUST_PROXY,
    frontendOrigin,
    cors: { origin: [frontendOrigin] },
  };
});
