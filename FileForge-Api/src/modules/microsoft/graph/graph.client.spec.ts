import authConfig from '../../../config/auth.config';
import type { MicrosoftIdentityService } from '../identity/microsoft-identity.service';
import { MicrosoftApiError } from '../microsoft.errors';
import { GraphClient } from './graph.client';

const context = { cache: { load: () => undefined, save: () => undefined }, homeAccountId: 'home-1' };
const TOKEN = 'SECRET-ACCESS-TOKEN';

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

describe('GraphClient', () => {
  let acquireTokenSilent: jest.Mock;
  let fetchMock: jest.SpyInstance;
  let client: GraphClient;

  beforeEach(() => {
    acquireTokenSilent = jest.fn().mockResolvedValue({ accessToken: TOKEN, expiresOn: null });
    client = new GraphClient({ acquireTokenSilent } as unknown as MicrosoftIdentityService, authConfig());
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  it('calls Graph with the delegated bearer token and returns the JSON body', async () => {
    fetchMock.mockResolvedValue(json({ id: 'u1' }));

    await expect(client.request(context, '/me')).resolves.toEqual({ id: 'u1' });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://graph.microsoft.com/v1.0/me');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(acquireTokenSilent).toHaveBeenCalledWith(
      expect.objectContaining({ homeAccountId: 'home-1', scopes: ['User.Read'] }),
    );
  });

  it('requests only the scopes the operation asks for', async () => {
    fetchMock.mockResolvedValue(json({}));
    await client.request(context, '/me/drive', { scopes: ['Files.ReadWrite'] });
    expect(acquireTokenSilent).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['Files.ReadWrite'] }));
  });

  it('returns undefined for 204 No Content', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(client.request(context, '/me/messages/1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it.each(['https://evil.example.com/steal', '//evil.example.com/x', 'me', '/..//..//evil'])(
    'refuses path "%s" so the bearer token can never leave Graph',
    async (path) => {
      const call = client.request(context, path);
      await call.catch(() => undefined);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(acquireTokenSilent).not.toHaveBeenCalled();
    },
  );

  it('renews the token once and retries when Graph answers 401', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ error: { code: 'InvalidAuthenticationToken' } }, { status: 401 }))
      .mockResolvedValueOnce(json({ id: 'ok' }));

    await expect(client.request(context, '/me')).resolves.toEqual({ id: 'ok' });

    expect(acquireTokenSilent).toHaveBeenCalledTimes(2);
    expect(acquireTokenSilent.mock.calls[0][0].forceRefresh).toBe(false);
    expect(acquireTokenSilent.mock.calls[1][0].forceRefresh).toBe(true);
  });

  it('asks the user to sign in again when 401 persists after renewal', async () => {
    fetchMock.mockImplementation(async () => json({}, { status: 401 }));
    await expect(client.request(context, '/me')).rejects.toMatchObject({ kind: 'reauth_required', status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2); // original + one retry, never a loop
  });

  it.each([
    [
      403,
      { error: { code: 'accessDenied', message: 'user@example.com may not read this' } },
      'forbidden',
      'accessDenied',
    ],
    [404, { error: { code: 'itemNotFound' } }, 'not_found', 'itemNotFound'],
    [500, {}, 'unavailable', undefined],
    [400, { error: { code: 'invalidRequest' } }, 'unknown', 'invalidRequest'],
  ])('maps HTTP %s to %s and keeps only the short Graph error code', async (status, body, kind, graphCode) => {
    fetchMock.mockResolvedValue(json(body, { status }));
    const error = await client.request(context, '/me').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MicrosoftApiError);
    expect(error).toMatchObject({ kind, status, graphCode });
    expect((error as Error).message).not.toContain('user@example.com'); // response messages can echo personal data
  });

  it('reports throttling with the Retry-After delay', async () => {
    fetchMock.mockResolvedValue(json({}, { status: 429, headers: { 'retry-after': '7' } }));
    await expect(client.request(context, '/me')).rejects.toMatchObject({ kind: 'throttled', retryAfterSeconds: 7 });
  });

  it('reports a network failure as unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(client.request(context, '/me')).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('propagates a re-authentication request from token acquisition without calling Graph', async () => {
    acquireTokenSilent.mockRejectedValue(new MicrosoftApiError('consent_required'));
    await expect(client.request(context, '/me/drive')).rejects.toMatchObject({ kind: 'consent_required' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never includes the access token in an error', async () => {
    fetchMock.mockResolvedValue(json({}, { status: 500 }));
    const error = (await client.request(context, '/me').catch((e: unknown) => e)) as Error;
    expect(error.message + error.name + JSON.stringify(error)).not.toContain(TOKEN);
  });
});
