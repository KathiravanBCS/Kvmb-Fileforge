import session, { type SessionOptions, type Store } from 'express-session';

export interface SessionMiddlewareOptions {
  secret: string;
  cookieName: string;
  ttlMs: number;
  secureCookies: boolean;
  /** Shared encrypted store. Omitted = in-memory, which is for LOCAL DEVELOPMENT ONLY (production config requires a store). */
  store?: Store;
}

/**
 * Server-side session cookie. Without a `store` the default in-memory store is used: sessions (and the Microsoft tokens
 * inside them) vanish on restart and do not scale past one process.
 */
export function createSessionMiddleware(options: SessionMiddlewareOptions) {
  const sessionOptions: SessionOptions = {
    name: options.cookieName,
    secret: options.secret,
    ...(options.store ? { store: options.store } : {}),
    resave: false,
    // No cookie until something is stored: anonymous visitors do not get a session.
    saveUninitialized: false,
    // Fixed (non-sliding) lifetime: a session cannot be kept alive past ttlMs by activity.
    rolling: false,
    unset: 'destroy',
    cookie: {
      httpOnly: true,
      // Lax still allows the top-level redirect back from Microsoft, but blocks cross-site POSTs.
      sameSite: 'lax',
      secure: options.secureCookies,
      path: '/',
      maxAge: options.ttlMs,
    },
  };
  return session(sessionOptions);
}
