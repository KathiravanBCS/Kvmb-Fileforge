import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import type { OAuthTransaction, SessionUser } from '../../../common/types/session.types';
import authConfig from '../../../config/auth.config';

// A browser that keeps starting flows cannot grow its session without bound.
const MAX_PENDING = 5;

/** The part of the (express) session this store reads and writes. */
export interface OAuthSessionHolder {
  user?: SessionUser;
  oauth?: Record<string, OAuthTransaction>;
  cookie: { maxAge?: number };
}

/**
 * Pending Microsoft redirects (state, nonce, PKCE verifier, purpose) kept in the visitor's own session.
 * Each is single use: `take` removes it, so a replayed callback finds nothing.
 */
@Injectable()
export class OAuthTransactionStore {
  constructor(@Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>) {}

  add(session: OAuthSessionHolder, state: string, transaction: Omit<OAuthTransaction, 'createdAt'>): void {
    const now = Date.now();
    const ttl = this.config.oauthTransactionTtlMs;

    // A visitor who is not signed in only keeps this session for as long as a login may take.
    if (!session.user) session.cookie.maxAge = ttl;

    const pending = Object.entries(session.oauth ?? {})
      .filter(([, existing]) => now - existing.createdAt < ttl)
      .sort(([, a], [, b]) => b.createdAt - a.createdAt)
      .slice(0, MAX_PENDING - 1);

    session.oauth = { ...Object.fromEntries(pending), [state]: { ...transaction, createdAt: now } };
  }

  /** Removes and returns the pending redirect for `state`, or undefined if unknown, already used or expired. */
  take(session: OAuthSessionHolder, state: string): OAuthTransaction | undefined {
    const pending = session.oauth;
    // hasOwn: a crafted state such as "__proto__" must not resolve to an inherited property.
    if (!pending || !Object.hasOwn(pending, state)) return undefined;
    const transaction = pending[state];
    delete pending[state];
    return transaction && Date.now() - transaction.createdAt <= this.config.oauthTransactionTtlMs
      ? transaction
      : undefined;
  }
}
