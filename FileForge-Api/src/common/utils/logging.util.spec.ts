import { describeError, serializeRequestForLog, stripQuery } from './logging.util';

describe('logging utilities', () => {
  it('drops the OAuth code and state from logged URLs', () => {
    const url = '/auth/microsoft/callback?code=SECRET-CODE&state=SECRET-STATE&session_state=x';
    expect(stripQuery(url)).toBe('/auth/microsoft/callback');
    expect(stripQuery('/auth/me')).toBe('/auth/me');
    expect(stripQuery(undefined)).toBe('');
  });

  it('logs only an allowlist of request fields: no headers, cookies or query', () => {
    const logged = serializeRequestForLog({
      id: 'req-1',
      method: 'GET',
      url: '/auth/microsoft/callback?code=SECRET-CODE',
      // @ts-expect-error extra fields that a raw request serializer would include
      headers: { cookie: 'fileforge.sid=SECRET', authorization: 'Bearer SECRET' },
    });
    expect(logged).toEqual({ id: 'req-1', method: 'GET', url: '/auth/microsoft/callback' });
    expect(JSON.stringify(logged)).not.toContain('SECRET');
  });

  it('describes errors without their message or stack, which may contain tokens', () => {
    const error = Object.assign(new Error('failed with access_token=SECRET'), { errorCode: 'invalid_grant' });
    const described = describeError(error);
    expect(described).toEqual({ name: 'Error', code: 'invalid_grant' });
    expect(JSON.stringify(described)).not.toContain('SECRET');
    expect(describeError('plain string')).toEqual({ name: 'string' });
  });
});
