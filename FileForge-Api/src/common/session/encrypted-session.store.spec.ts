import { randomBytes } from 'node:crypto';

import express from 'express';
import type { SessionData } from 'express-session';
import request from 'supertest';

import { Logger } from '@nestjs/common';

import { createSessionMiddleware } from '../middleware/session.middleware';
import { seal, SealedDataError, unseal } from '../utils/aes-gcm.util';
import { EncryptedPgSessionStore, hashSessionId } from './encrypted-session.store';
import type { SessionRepository, SessionWrite, StoredSession } from './session.repository';

/** In-memory stand-in for core.sessions with the same contract (earlier expiry wins, expired rows are invisible). */
class MemoryRepository implements SessionRepository {
  readonly rows = new Map<string, SessionWrite>();
  now = () => Date.now();

  find(sidHash: Buffer): Promise<StoredSession | null> {
    const row = this.rows.get(sidHash.toString('hex'));
    return Promise.resolve(row && row.expiresAt.getTime() > this.now() ? row : null);
  }
  upsert(write: SessionWrite): Promise<void> {
    const key = write.sidHash.toString('hex');
    const existing = this.rows.get(key);
    const expiresAt = existing && existing.expiresAt < write.expiresAt ? existing.expiresAt : write.expiresAt;
    this.rows.set(key, { ...write, expiresAt });
    return Promise.resolve();
  }
  remove(sidHash: Buffer): Promise<void> {
    this.rows.delete(sidHash.toString('hex'));
    return Promise.resolve();
  }
  removeExpired(): Promise<number> {
    let removed = 0;
    for (const [key, row] of this.rows) {
      if (row.expiresAt.getTime() <= this.now()) {
        this.rows.delete(key);
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  }
}

const KEY = randomBytes(32);
const TTL_MS = 60_000;

function makeStore(repository: SessionRepository, key = KEY, keyVersion = 1) {
  return new EncryptedPgSessionStore({ repository, key, keyVersion, defaultTtlMs: TTL_MS });
}

/** Store callbacks pass `unknown`; a rejection must be an Error. */
const asError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));
const get = (store: EncryptedPgSessionStore, sid: string) =>
  new Promise<SessionData | null | undefined>((resolve, reject) =>
    store.get(sid, (error, data) => (error ? reject(asError(error)) : resolve(data))),
  );
const set = (store: EncryptedPgSessionStore, sid: string, data: SessionData) =>
  new Promise<void>((resolve, reject) => store.set(sid, data, (error) => (error ? reject(asError(error)) : resolve())));
const destroy = (store: EncryptedPgSessionStore, sid: string) =>
  new Promise<void>((resolve, reject) => store.destroy(sid, (error) => (error ? reject(asError(error)) : resolve())));

function sessionData(extra: Record<string, unknown> = {}, expires = new Date(Date.now() + TTL_MS)): SessionData {
  return { cookie: { originalMaxAge: TTL_MS, expires, httpOnly: true, path: '/' }, ...extra };
}

describe('aes-gcm util', () => {
  const aad = Buffer.from('context');

  it('round-trips and uses a fresh nonce every time', () => {
    const a = seal(KEY, 'hello', aad);
    const b = seal(KEY, 'hello', aad);
    expect(unseal(KEY, a, aad)).toBe('hello');
    expect(a.nonce.equals(b.nonce)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it.each([
    ['wrong key', (s: ReturnType<typeof seal>) => ({ sealed: s, key: randomBytes(32), aad })],
    ['wrong context', (s: ReturnType<typeof seal>) => ({ sealed: s, key: KEY, aad: Buffer.from('other') })],
    [
      'modified ciphertext',
      (s: ReturnType<typeof seal>) => ({
        sealed: { ...s, ciphertext: Buffer.from(s.ciphertext).fill(0) },
        key: KEY,
        aad,
      }),
    ],
    ['modified tag', (s: ReturnType<typeof seal>) => ({ sealed: { ...s, authTag: randomBytes(16) }, key: KEY, aad })],
    ['modified nonce', (s: ReturnType<typeof seal>) => ({ sealed: { ...s, nonce: randomBytes(12) }, key: KEY, aad })],
    ['short nonce', (s: ReturnType<typeof seal>) => ({ sealed: { ...s, nonce: randomBytes(8) }, key: KEY, aad })],
  ])('rejects %s with an opaque error', (_name, tamper) => {
    const { sealed, key, aad: context } = tamper(seal(KEY, 'secret-value', aad));
    expect(() => unseal(key, sealed, context)).toThrow(SealedDataError);
    try {
      unseal(key, sealed, context);
    } catch (error) {
      expect((error as Error).message).not.toContain('secret-value');
    }
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => seal(randomBytes(16), 'x', aad)).toThrow();
  });
});

describe('EncryptedPgSessionStore', () => {
  let repository: MemoryRepository;
  let store: EncryptedPgSessionStore;

  beforeEach(() => {
    repository = new MemoryRepository();
    store = makeStore(repository);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('stores only ciphertext: no plaintext token, csrf value or session id reaches the table', async () => {
    const sid = 'sid-super-secret-0001';
    await set(
      store,
      sid,
      sessionData({ csrfToken: 'csrf-plain-value', user: { id: '7' }, msal: { cache: 'refresh-token-plain' } }),
    );
    const [row] = [...repository.rows.values()];
    const dump = JSON.stringify([...repository.rows.entries()], (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    for (const secret of ['csrf-plain-value', 'refresh-token-plain', sid]) {
      expect(dump).not.toContain(secret);
      expect(row?.ciphertext.toString('utf8')).not.toContain(secret);
    }
    expect(row?.sidHash.equals(hashSessionId(sid))).toBe(true);
    expect(row?.nonce).toHaveLength(12);
    expect(row?.authTag).toHaveLength(16);
    expect(row?.userId).toBe(7n);
    expect(row?.keyVersion).toBe(1);
  });

  it('reads back what was stored', async () => {
    await set(store, 'sid-a', sessionData({ user: { id: '5' }, csrfToken: 'abc' }));
    const loaded = await get(store, 'sid-a');
    expect(loaded).toMatchObject({ user: { id: '5' }, csrfToken: 'abc' });
  });

  it('records no user id for a visitor and ignores a non-numeric one', async () => {
    await set(store, 'sid-anon', sessionData({ oauth: { state: 'x' } }));
    await set(store, 'sid-odd', sessionData({ user: { id: '1; DROP TABLE core.users' } }));
    expect([...repository.rows.values()].map((r) => r.userId)).toEqual([null, null]);
  });

  it('survives a "restart": a new store with the same key reads the old session', async () => {
    await set(store, 'sid-restart', sessionData({ user: { id: '9' } }));
    const restarted = makeStore(repository);
    expect(await get(restarted, 'sid-restart')).toMatchObject({ user: { id: '9' } });
  });

  it('returns no session for an unknown id', async () => {
    expect(await get(store, 'nope')).toBeNull();
  });

  it('treats an expired session as missing', async () => {
    await set(store, 'sid-exp', sessionData({ user: { id: '1' } }, new Date(Date.now() + 5_000)));
    repository.now = () => Date.now() + 10_000;
    expect(await get(store, 'sid-exp')).toBeNull();
    expect(await repository.removeExpired()).toBe(1);
  });

  it('never extends the lifetime: a later write keeps the earlier expiry, and touch does nothing', async () => {
    const first = new Date(Date.now() + 5_000);
    await set(store, 'sid-fixed', sessionData({ n: 1 }, first));
    await set(store, 'sid-fixed', sessionData({ n: 2 }, new Date(Date.now() + 3_600_000)));
    const [row] = [...repository.rows.values()];
    expect(row?.expiresAt.getTime()).toBe(first.getTime());
    const before = repository.rows.size;
    await new Promise<void>((resolve) => store.touch('sid-fixed', sessionData(), () => resolve()));
    expect(repository.rows.size).toBe(before);
    expect([...repository.rows.values()][0]?.expiresAt.getTime()).toBe(first.getTime());
  });

  it('deletes the row on destroy (logout)', async () => {
    await set(store, 'sid-out', sessionData({ user: { id: '1' } }));
    await destroy(store, 'sid-out');
    expect(repository.rows.size).toBe(0);
    expect(await get(store, 'sid-out')).toBeNull();
  });

  it('a wrong key cannot read the session and the unreadable row is removed', async () => {
    await set(store, 'sid-key', sessionData({ user: { id: '1' } }));
    const otherKey = makeStore(repository, randomBytes(32));
    expect(await get(otherKey, 'sid-key')).toBeNull();
    expect(repository.rows.size).toBe(0);
  });

  it('a different key version is not read (and not guessed at)', async () => {
    await set(store, 'sid-ver', sessionData({ user: { id: '1' } }));
    expect(await get(makeStore(repository, KEY, 2), 'sid-ver')).toBeNull();
    expect(repository.rows.size).toBe(0);
  });

  it('a tampered ciphertext is rejected', async () => {
    await set(store, 'sid-t', sessionData({ user: { id: '1' } }));
    const [key, row] = [...repository.rows.entries()][0] ?? [];
    const flipped = Buffer.from(row.ciphertext);
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    repository.rows.set(key, { ...row, ciphertext: flipped });
    expect(await get(store, 'sid-t')).toBeNull();
  });

  it('a row copied under another session id does not decrypt (ciphertext is bound to its id)', async () => {
    await set(store, 'sid-victim', sessionData({ user: { id: '1' } }));
    const victim = [...repository.rows.values()][0];
    repository.rows.set(hashSessionId('sid-attacker').toString('hex'), {
      ...victim,
      sidHash: hashSessionId('sid-attacker'),
    });
    expect(await get(store, 'sid-attacker')).toBeNull();
  });

  it('does not log session content, ids or keys when it discards a row', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    await set(store, 'sid-log-secret', sessionData({ csrfToken: 'csrf-log-secret' }));
    await get(makeStore(repository, randomBytes(32)), 'sid-log-secret');
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('sid-log-secret');
    expect(logged).not.toContain('csrf-log-secret');
    expect(logged).toContain('session_decrypt_failed');
  });

  it('propagates a database failure to express-session instead of pretending there is no session', async () => {
    repository.find = () => Promise.reject(new Error('db down'));
    await expect(get(store, 'sid-x')).rejects.toThrow('db down');
  });
});

describe('sessions through the real express-session middleware', () => {
  const OPTIONS = { secret: 'x'.repeat(40), cookieName: 'fileforge.sid', ttlMs: TTL_MS, secureCookies: false };

  function buildApp(repository: SessionRepository) {
    const app = express();
    app.use(createSessionMiddleware({ ...OPTIONS, store: makeStore(repository) }));
    app.post('/login', (req, res) => {
      req.session.regenerate(() => {
        (req.session as unknown as Record<string, unknown>)['user'] = { id: '42' };
        res.status(204).end();
      });
    });
    app.get('/me', (req, res) => {
      res.json({ user: (req.session as unknown as Record<string, unknown>)['user'] ?? null });
    });
    app.post('/logout', (req, res) => {
      req.session.destroy(() => res.status(204).end());
    });
    app.get('/anon', (_req, res) => res.status(204).end());
    return app;
  }

  const cookieOf = (res: request.Response) =>
    (res.headers['set-cookie'] as unknown as string[] | undefined)?.[0]?.split(';')[0];

  it('keeps a login across a backend restart (a second app instance on the same table)', async () => {
    const repository = new MemoryRepository();
    const login = await request(buildApp(repository)).post('/login').expect(204);
    const cookie = cookieOf(login)!;
    const res = await request(buildApp(repository)).get('/me').set('Cookie', cookie).expect(200);
    expect(res.body.user).toEqual({ id: '42' });
  });

  it('logout invalidates the session for every instance', async () => {
    const repository = new MemoryRepository();
    const cookie = cookieOf(await request(buildApp(repository)).post('/login').expect(204))!;
    await request(buildApp(repository)).post('/logout').set('Cookie', cookie).expect(204);
    const res = await request(buildApp(repository)).get('/me').set('Cookie', cookie).expect(200);
    expect(res.body.user).toBeNull();
    expect(repository.rows.size).toBe(0);
  });

  it('regenerating at login issues a new id and the pre-login id stops working (no fixation)', async () => {
    const repository = new MemoryRepository();
    const app = buildApp(repository);
    const login = await request(app).post('/login').expect(204);
    const loggedIn = cookieOf(login)!;
    const attackerKnownId = 'fixed-by-attacker';
    const forged = `fileforge.sid=s%3A${attackerKnownId}.bad`;
    const res = await request(app).get('/me').set('Cookie', forged).expect(200);
    expect(res.body.user).toBeNull();
    expect(loggedIn).not.toContain(attackerKnownId);
  });

  it('anonymous visitors get no cookie and no row', async () => {
    const repository = new MemoryRepository();
    const res = await request(buildApp(repository)).get('/anon').expect(204);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(repository.rows.size).toBe(0);
  });

  it('stores the session cookie flags the API relies on (HttpOnly, SameSite=Lax)', async () => {
    const res = await request(buildApp(new MemoryRepository())).post('/login').expect(204);
    const header = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
  });
});
