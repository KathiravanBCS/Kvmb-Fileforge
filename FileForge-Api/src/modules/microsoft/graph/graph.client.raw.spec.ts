import authConfig from '../../../config/auth.config';
import type { MicrosoftIdentityService } from '../identity/microsoft-identity.service';
import { GraphClient } from './graph.client';

const context = { cache: { load: () => undefined, save: () => undefined }, homeAccountId: 'home-1' };

describe('GraphClient: raw requests, links and conflicts', () => {
  let acquireTokenSilent: jest.Mock;
  let fetchMock: jest.SpyInstance;
  let client: GraphClient;

  beforeEach(() => {
    acquireTokenSilent = jest.fn().mockResolvedValue({ accessToken: 'tok', expiresOn: null });
    client = new GraphClient({ acquireTokenSilent } as unknown as MicrosoftIdentityService, authConfig());
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  it('requestRaw returns the successful response untouched, so a body can be streamed', async () => {
    const response = new Response('FILE-BYTES', { status: 200 });
    fetchMock.mockResolvedValue(response);
    await expect(
      client.requestRaw(context, '/drives/d/items/i:/a.pdf:/content', { scopes: ['Files.ReadWrite'] }),
    ).resolves.toBe(response);
    expect(acquireTokenSilent).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['Files.ReadWrite'] }));
  });

  it('requestRaw refreshes once on 401 and maps failures like request does', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    await expect(client.requestRaw(context, '/me/drive')).resolves.toBeDefined();
    expect(acquireTokenSilent.mock.calls.map((c) => c[0].forceRefresh)).toEqual([false, true]);

    fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 404 }));
    await expect(client.requestRaw(context, '/me/drive')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('maps HTTP 409 to a conflict', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'nameAlreadyExists' } }), { status: 409 }),
    );
    await expect(client.request(context, '/me/drive/root/children', { method: 'POST' })).rejects.toMatchObject({
      kind: 'conflict',
      status: 409,
      graphCode: 'nameAlreadyExists',
    });
  });

  it('sends a binary body unchanged for uploads', async () => {
    fetchMock.mockResolvedValue(new Response('{"id":"1"}', { status: 201 }));
    const body = new Uint8Array([1, 2, 3, 250]);
    await client.request(context, '/drives/d/items/i:/a.bin:/content', {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(init.body).toBe(body);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/octet-stream');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
  });

  describe('pathFromLink (next-page links)', () => {
    it('turns a Graph link into a path under the base, keeping the query', () => {
      expect(client.pathFromLink('https://graph.microsoft.com/v1.0/drives/d/items/r/children?$skiptoken=abc')).toBe(
        '/drives/d/items/r/children?$skiptoken=abc',
      );
    });

    it.each([
      ['another host', 'https://evil.example/v1.0/drives/d/children'],
      ['a look-alike host', 'https://graph.microsoft.com.evil.example/v1.0/x'],
      ['another API version', 'https://graph.microsoft.com/beta/me/drive'],
      ['plain http', 'http://graph.microsoft.com/v1.0/me/drive'],
      ['a different port', 'https://graph.microsoft.com:8443/v1.0/me/drive'],
      ['a traversal out of /v1.0', 'https://graph.microsoft.com/v1.0/../beta/me'],
    ])('refuses %s', (_label, link) => {
      expect(() => client.pathFromLink(link)).toThrow();
    });
  });
});
