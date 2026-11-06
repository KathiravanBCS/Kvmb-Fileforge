import { randomBytes } from 'node:crypto';

import { Logger } from '@nestjs/common';

import { AuthFlowError } from '../../common/exceptions/auth-flow.error';
import type { PrismaService } from '../../prisma/prisma.service';
import { centralTables } from '../../testing/central-fixtures';
import { createFakePrisma, Mutex, type FakeTables } from '../../testing/fake-prisma';
import type { MicrosoftIdentityService } from '../microsoft/identity/microsoft-identity.service';
import { MicrosoftApiError } from '../microsoft/microsoft.errors';
import { cacheAad, decryptCache } from './central-token-crypto';
import { CentralTokenVault } from './central-token-vault.service';
import type { CentralLayout, ConnectedAccount } from './types/central-storage.types';

const KEY = randomBytes(32);
const ACCOUNT: ConnectedAccount = {
  ownerUserId: 1n,
  issuer: 'https://login.microsoftonline.com/tenant/v2.0',
  subject: 'oid-admin',
  tenantId: 'tenant',
  accountType: 'personal',
  homeAccountId: 'home-admin',
  email: 'admin@example.com',
  displayName: 'Admin',
};
const LAYOUT: CentralLayout = { driveId: 'drive-1', rootItemId: 'root-1', usersFolderItemId: 'users-1' };
const CACHE = JSON.stringify({ rt: 'REFRESH-TOKEN-SECRET', stale: true, gen: 1 });

/** MSAL stand-in: refreshes (and rewrites the cache) only when the cached access token is stale. */
function fakeIdentity() {
  const identity = {
    refreshes: 0,
    acquireTokenSilent: jest.fn(async ({ cache }: { cache: { load(): string | undefined; save(s: string): void } }) => {
      const current = JSON.parse(cache.load() ?? '{}') as { stale?: boolean; gen: number };
      if (current.stale) {
        identity.refreshes++;
        await new Promise((resolve) => setTimeout(resolve, 5)); // a real network call: other requests interleave here
        cache.save(JSON.stringify({ ...current, stale: false, gen: current.gen + 1 }));
      }
      return { accessToken: 'ACCESS', expiresOn: new Date(Date.now() + 3_600_000) };
    }),
  };
  return identity;
}

function makeVault(
  tables: FakeTables,
  options: { key?: Buffer; version?: number; mutex?: Mutex; identity?: ReturnType<typeof fakeIdentity> } = {},
) {
  const identity = options.identity ?? fakeIdentity();
  const prisma = createFakePrisma(tables, options.mutex ? { mutex: options.mutex } : undefined);
  const vault = new CentralTokenVault(
    prisma as unknown as PrismaService,
    identity as unknown as MicrosoftIdentityService,
    { encryptionKey: options.key ?? KEY, keyVersion: options.version ?? 1 },
  );
  return { vault, identity, prisma };
}

function connected() {
  const tables = centralTables();
  tables['storage_provider_types']?.seed({ id: 3n, code: 'onedrive' });
  const { vault, identity } = makeVault(tables);
  return { tables, vault, identity, connection: tables['central_connection'] };
}

/** Decrypts a stored row with the test key, to assert what is really persisted. */
function decryptRow(row: Record<string, unknown>): Promise<string> {
  return Promise.resolve(
    decryptCache(
      KEY,
      {
        ciphertext: Buffer.from(row['token_cache_ciphertext'] as Uint8Array),
        nonce: Buffer.from(row['token_cache_nonce'] as Uint8Array),
        authTag: Buffer.from(row['token_cache_auth_tag'] as Uint8Array),
      },
      cacheAad(row['encryption_key_version'] as number, row['id'] as bigint, row['account_subject'] as string),
    ),
  );
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    const e = error as { response?: { code?: string } };
    return e.response?.code ?? (error as Error).name;
  }
  return undefined;
};

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe('saveConnected: the first authorization', () => {
  it('stores the cache ONLY as ciphertext, bound to the new row id and account', async () => {
    const { tables, vault, connection } = connected();
    const id = await vault.saveConnected(ACCOUNT, LAYOUT, ['Files.ReadWrite'], CACHE, 1n);

    const row = connection.rows[0] as Record<string, unknown>;
    expect(connection.rows).toHaveLength(1);
    expect(row['id']).toBe(id);
    expect(row['connection_status']).toBe('connected');
    expect(row['root_folder_path']).toBe('FileForge-Central');
    expect(row['external_drive_id']).toBe('drive-1');

    const stored = [row['token_cache_ciphertext'], row['token_cache_nonce'], row['token_cache_auth_tag']].map((b) =>
      Buffer.from(b as Uint8Array),
    );
    expect(Buffer.concat(stored).toString('latin1')).not.toContain('REFRESH-TOKEN-SECRET');
    expect(JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain(
      'REFRESH-TOKEN-SECRET',
    );

    const plain = decryptCache(
      KEY,
      { ciphertext: stored[0], nonce: stored[1], authTag: stored[2] },
      cacheAad(1, id, 'oid-admin'),
    );
    expect(plain).toBe(CACHE);
    expect(tables['central_connection']?.rows).toHaveLength(1);
  });

  it('reconnecting the SAME account updates the row (new revision) instead of creating another connection', async () => {
    const { vault, connection } = connected();
    const id = await vault.saveConnected(ACCOUNT, LAYOUT, ['Files.ReadWrite'], CACHE, 1n);
    const again = await vault.saveConnected(
      ACCOUNT,
      LAYOUT,
      ['Files.ReadWrite'],
      JSON.stringify({ rt: 'NEW', stale: false, gen: 1 }),
      1n,
    );

    expect(again).toBe(id);
    expect(connection.rows).toHaveLength(1);
    expect((connection.rows[0] as Record<string, unknown>)['cache_revision']).toBe(2n);
  });

  it('refuses a DIFFERENT Microsoft account or drive: it can never replace the designated connection', async () => {
    const { vault, connection } = connected();
    await vault.saveConnected(ACCOUNT, LAYOUT, ['Files.ReadWrite'], CACHE, 1n);
    const before = JSON.stringify(connection.rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

    const otherAccount = { ...ACCOUNT, subject: 'oid-someone-else' };
    await expect(vault.saveConnected(otherAccount, LAYOUT, [], CACHE, 1n)).rejects.toMatchObject({
      code: 'account_mismatch',
    });
    await expect(
      vault.saveConnected(ACCOUNT, { ...LAYOUT, driveId: 'another-drive' }, [], CACHE, 1n),
    ).rejects.toBeInstanceOf(AuthFlowError);

    expect(JSON.stringify(connection.rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(before);
  });
});

describe('using the connection', () => {
  it('survives a backend restart: a brand-new vault decrypts the stored cache and keeps the SAME single connection', async () => {
    const { tables, vault } = connected();
    await vault.saveConnected(ACCOUNT, LAYOUT, ['Files.ReadWrite'], CACHE, 1n);
    await vault.withGraph(async () => undefined); // refreshes once (the cache holds a stale access token)

    const restarted = makeVault(tables); // no memory of anything: like a process restart
    let seenCache: string | undefined;
    await restarted.vault.withGraph(async ({ graph }) => {
      seenCache = 'cache' in graph ? graph.cache.load() : undefined;
    });

    expect(JSON.parse(seenCache ?? '{}')).toMatchObject({ rt: 'REFRESH-TOKEN-SECRET', stale: false });
    expect(restarted.identity.refreshes).toBe(0); // nothing to refresh: the stored access token is still good
    expect(tables['central_connection']?.rows).toHaveLength(1);
  });

  it('hands out ids from PostgreSQL only: no tokens in the returned connection', async () => {
    const { vault } = connected();
    await vault.saveConnected(ACCOUNT, LAYOUT, ['Files.ReadWrite'], CACHE, 1n);
    const usable = await vault.usableConnection();
    expect(usable).toEqual({
      id: expect.any(BigInt),
      driveId: 'drive-1',
      rootItemId: 'root-1',
      usersFolderItemId: 'users-1',
      ownerUserId: 1n,
    });
  });

  it('says "not connected" when there is no connection, and never invents one', async () => {
    const { vault, connection } = connected();
    expect(await codeOf(vault.withGraph(async () => 1))).toBe('CENTRAL_STORAGE_NOT_CONNECTED');
    expect(connection.rows).toHaveLength(0);
  });
});

describe('a cache that cannot be trusted fails SAFELY', () => {
  async function corrupt(mutate: (row: Record<string, unknown>) => void) {
    const ctx = connected();
    await ctx.vault.saveConnected(ACCOUNT, LAYOUT, ['Files.ReadWrite'], CACHE, 1n);
    const row = ctx.connection.rows[0] as Record<string, unknown>;
    mutate(row);
    const snapshot = Buffer.from(row['token_cache_ciphertext'] as Uint8Array).toString('hex');
    return { ...ctx, row, snapshot };
  }

  it.each([
    [
      'a modified ciphertext',
      (row: Record<string, unknown>) => {
        const c = Buffer.from(row['token_cache_ciphertext'] as Uint8Array);
        c[0] = c[0] ^ 1;
        row['token_cache_ciphertext'] = new Uint8Array(c);
      },
    ],
    [
      'a modified auth tag',
      (row: Record<string, unknown>) => {
        const t = Buffer.from(row['token_cache_auth_tag'] as Uint8Array);
        t[0] = t[0] ^ 1;
        row['token_cache_auth_tag'] = new Uint8Array(t);
      },
    ],
    [
      'a row copied to another account',
      (row: Record<string, unknown>) => {
        row['account_subject'] = 'oid-other';
      },
    ],
    [
      'an unknown key version',
      (row: Record<string, unknown>) => {
        row['encryption_key_version'] = 9;
      },
    ],
  ])('refuses to use %s, records why, and never touches the data', async (_label, mutate) => {
    const { vault, identity, connection, row, snapshot } = await corrupt(mutate);

    expect(await codeOf(vault.withGraph(async () => 'should not run'))).toBe('CENTRAL_STORAGE_RECONNECT_REQUIRED');

    expect(identity.acquireTokenSilent).not.toHaveBeenCalled(); // nothing was sent to Microsoft
    expect(connection.rows).toHaveLength(1); // no replacement connection was created
    expect(row['connection_status']).toBe('error');
    expect(row['last_error_code']).toBe('cache_decryption_failed');
    expect(Buffer.from(row['token_cache_ciphertext'] as Uint8Array).toString('hex')).toBe(snapshot); // not "repaired"

    // And it stays refused until an administrator reconnects.
    expect(await codeOf(vault.withGraph(async () => 'should not run'))).toBe('CENTRAL_STORAGE_RECONNECT_REQUIRED');
  });

  it('refuses a wrong encryption key the same way (e.g. the key in .env was changed)', async () => {
    const { tables } = connected();
    const first = makeVault(tables);
    tables['storage_provider_types']?.seed({ id: 3n, code: 'onedrive' });
    await first.vault.saveConnected(ACCOUNT, LAYOUT, [], CACHE, 1n);

    const wrongKey = makeVault(tables, { key: randomBytes(32) });
    expect(await codeOf(wrongKey.vault.withGraph(async () => 1))).toBe('CENTRAL_STORAGE_RECONNECT_REQUIRED');
    expect(wrongKey.identity.acquireTokenSilent).not.toHaveBeenCalled();
    expect(tables['central_connection']?.rows).toHaveLength(1);
  });

  it('an administrator can recover by reconnecting the same account: the row is repaired, not duplicated', async () => {
    const { vault, connection, row } = await corrupt((r) => {
      r['token_cache_ciphertext'] = new Uint8Array([1, 2, 3]);
    });
    await codeOf(vault.withGraph(async () => 1)); // marks it `error`
    expect(row['connection_status']).toBe('error');

    await vault.saveConnected(ACCOUNT, LAYOUT, ['Files.ReadWrite'], CACHE, 1n);
    expect(connection.rows).toHaveLength(1);
    expect(row['connection_status']).toBe('connected');
    expect(row['last_error_code']).toBeNull();
    expect(await codeOf(vault.withGraph(async () => 'ok'))).toBeUndefined();
  });
});

describe('refreshing tokens', () => {
  it('two backend instances refreshing at once refresh ONCE and never overwrite each other', async () => {
    const tables = centralTables();
    tables['storage_provider_types']?.seed({ id: 3n, code: 'onedrive' });
    const mutex = new Mutex(); // the Postgres advisory lock: shared by every instance
    const identity = fakeIdentity();
    const a = makeVault(tables, { mutex, identity });
    const b = makeVault(tables, { mutex, identity });
    await a.vault.saveConnected(ACCOUNT, LAYOUT, [], CACHE, 1n);

    await Promise.all([
      a.vault.withGraph(async () => 'a'),
      b.vault.withGraph(async () => 'b'),
      a.vault.withGraph(async () => 'a2'),
    ]);

    expect(identity.refreshes).toBe(1); // the second instance saw the first one's fresh cache
    const row = tables['central_connection']?.rows[0] as Record<string, unknown>;
    // Revision 1 is the connect; the single refresh wrote revision 2; nobody else wrote anything.
    expect(row['cache_revision']).toBe(2n);
    expect(JSON.parse(await decryptRow(row))).toMatchObject({ rt: 'REFRESH-TOKEN-SECRET', stale: false, gen: 2 });
  });

  it('a stale writer cannot overwrite a newer cache (compare-and-swap on cache_revision)', async () => {
    const { vault, connection } = connected();
    await vault.saveConnected(ACCOUNT, LAYOUT, [], JSON.stringify({ rt: 'ORIGINAL', stale: false, gen: 1 }), 1n);
    const row = connection.rows[0] as Record<string, unknown>;

    await vault.withGraph(async ({ graph }) => {
      // Meanwhile another instance stores a newer cache...
      row['cache_revision'] = (row['cache_revision'] as bigint) + 1n;
      row['token_cache_ciphertext'] = new Uint8Array([9, 9, 9]);
      // ...and this operation's MSAL also changed its (older) copy.
      if ('cache' in graph) graph.cache.save('{"rt":"OLDER-COPY"}');
    });

    expect(Array.from(row['token_cache_ciphertext'] as Uint8Array)).toEqual([9, 9, 9]); // the newer one survived
  });

  it('lost authorization (expired/revoked consent) marks the connection reauth_required and stays that way', async () => {
    const { vault, identity, connection } = connected();
    await vault.saveConnected(ACCOUNT, LAYOUT, [], CACHE, 1n);
    const row = connection.rows[0] as Record<string, unknown>;
    row['cache_revision'] = 5n;
    identity.acquireTokenSilent.mockRejectedValueOnce(new MicrosoftApiError('reauth_required'));
    // The vault reports the Microsoft failure itself (the Graph layer maps it to a 503 RECONNECT_REQUIRED, see the
    // onedrive service tests) and records the state.
    expect(await codeOf(vault.withGraph(async () => 'x'))).toBe('MicrosoftApiError');
    expect(row['connection_status']).toBe('reauth_required');
    expect(row['last_error_code']).toBe('reauth_required');

    identity.acquireTokenSilent.mockClear();
    expect(await codeOf(vault.withGraph(async () => 'x'))).toBe('CENTRAL_STORAGE_RECONNECT_REQUIRED');
    expect(identity.acquireTokenSilent).not.toHaveBeenCalled(); // it does not hammer Microsoft

    await vault.saveConnected(ACCOUNT, LAYOUT, [], CACHE, 1n); // the administrator reconnects
    expect(row['connection_status']).toBe('connected');
    expect(await codeOf(vault.withGraph(async () => 'ok'))).toBeUndefined();
  });

  it('consent_required is treated like a lost authorization', async () => {
    const { vault, identity, connection } = connected();
    await vault.saveConnected(ACCOUNT, LAYOUT, [], CACHE, 1n);
    identity.acquireTokenSilent.mockRejectedValueOnce(new MicrosoftApiError('consent_required'));
    expect(await codeOf(vault.withGraph(async () => 'x'))).toBe('MicrosoftApiError');
    expect((connection.rows[0] as Record<string, unknown>)['last_error_code']).toBe('consent_required');
  });
});
