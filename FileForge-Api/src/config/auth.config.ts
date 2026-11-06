import { registerAs } from '@nestjs/config';

import { validateEnv } from './env.validation';

// Sign-in only. Files.ReadWrite / Mail.* are requested later, by the phase that needs them.
const LOGIN_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'User.Read'];

export default registerAs('auth', () => {
  const env = validateEnv(process.env);
  const secureCookies = new URL(env.FRONTEND_URL).protocol === 'https:';

  return {
    microsoft: {
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      authority: env.MICROSOFT_AUTHORITY,
      redirectUri: env.MICROSOFT_REDIRECT_URI,
      loginScopes: LOGIN_SCOPES,
      graphBaseUrl: 'https://graph.microsoft.com/v1.0',
    },
    session: {
      secret: env.SESSION_SECRET,
      ttlMs: env.SESSION_TTL_MINUTES * 60 * 1000,
      // The __Host- prefix is only valid for Secure cookies (https).
      cookieName: secureCookies ? '__Host-fileforge.sid' : 'fileforge.sid',
      secureCookies,
    },
    // How long a started login may take before its state/nonce/PKCE values are rejected.
    oauthTransactionTtlMs: 10 * 60 * 1000,
  };
});
