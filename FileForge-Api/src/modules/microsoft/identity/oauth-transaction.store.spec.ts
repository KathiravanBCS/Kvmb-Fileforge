import type { OAuthTransaction } from '../../../common/types/session.types';
import authConfig from '../../../config/auth.config';
import { OAuthTransactionStore, type OAuthSessionHolder } from './oauth-transaction.store';
import { sessionTokenCache, stagedTokenCache } from './session-token-cache';

const config = authConfig();
const TTL = config.oauthTransactionTtlMs;
const tx = (purpose: 'login' | 'connect_onedrive' = 'login'): Omit<OAuthTransaction, 'createdAt'> => ({
  codeVerifier: 'v',
  nonce: 'n',
  purpose,
});
const newSession = (): OAuthSessionHolder => ({ cookie: {} });

describe('OAuthTransactionStore', () => {
  const store = new OAuthTransactionStore(config);
  afterEach(() => jest.restoreAllMocks());

  it('keeps the purpose and workspace of a pending redirect, and hands it out exactly once', () => {
    const session = newSession();
    store.add(session, 'state-1', { ...tx('connect_onedrive'), workspaceId: '12' });

    expect(store.take(session, 'state-1')).toMatchObject({
      purpose: 'connect_onedrive',
      workspaceId: '12',
      nonce: 'n',
    });
    expect(store.take(session, 'state-1')).toBeUndefined(); // replay finds nothing
  });

  it('returns nothing for an unknown state, and for inherited property names', () => {
    const session = newSession();
    store.add(session, 'state-1', tx());
    expect(store.take(session, 'other')).toBeUndefined();
    for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(store.take(session, key)).toBeUndefined();
    }
    expect(store.take(newSession(), 'state-1')).toBeUndefined(); // another visitor's session has nothing
  });

  it('refuses a redirect that took longer than the allowed time, and still consumes it', () => {
    const session = newSession();
    store.add(session, 'state-1', tx());
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + TTL + 1000);
    expect(store.take(session, 'state-1')).toBeUndefined();
    expect(session.oauth).not.toHaveProperty('state-1');
  });

  it('caps how many redirects one session can have pending, dropping the oldest', () => {
    const session = newSession();
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now++);
    for (let i = 1; i <= 8; i++) store.add(session, `state-${i}`, tx());

    expect(Object.keys(session.oauth ?? {})).toHaveLength(5);
    expect(session.oauth).toHaveProperty('state-8');
    expect(session.oauth).not.toHaveProperty('state-1');
  });

  it('gives a visitor who is not signed in a short-lived session, but leaves a signed-in session alone', () => {
    const anonymous = newSession();
    store.add(anonymous, 's', tx());
    expect(anonymous.cookie.maxAge).toBe(TTL);

    const signedIn: OAuthSessionHolder = {
      cookie: { maxAge: 8 * 3600 * 1000 },
      user: { id: '1', email: 'a@b.c', displayName: null },
    };
    store.add(signedIn, 's', tx('connect_onedrive'));
    expect(signedIn.cookie.maxAge).toBe(8 * 3600 * 1000);
  });
});

describe('token cache helpers', () => {
  it('sessionTokenCache reads and writes the session field', () => {
    const holder: { msalCache?: string } = {};
    const cache = sessionTokenCache(holder);
    expect(cache.load()).toBeUndefined();
    cache.save('CACHE-1');
    expect(holder.msalCache).toBe('CACHE-1');
    expect(cache.load()).toBe('CACHE-1');
  });

  it('stagedTokenCache reads through, but writes nothing to the session until committed', () => {
    const holder = { msalCache: 'OLD' };
    const staged = stagedTokenCache(sessionTokenCache(holder));

    expect(staged.store.load()).toBe('OLD');
    staged.store.save('NEW');
    expect(staged.store.load()).toBe('NEW');
    expect(holder.msalCache).toBe('OLD'); // still untouched: discarding the stage leaves the session as it was

    staged.commit();
    expect(holder.msalCache).toBe('NEW');
  });

  it('commit without any write changes nothing', () => {
    const holder: { msalCache?: string } = { msalCache: 'OLD' };
    stagedTokenCache(sessionTokenCache(holder)).commit();
    expect(holder.msalCache).toBe('OLD');
  });
});
