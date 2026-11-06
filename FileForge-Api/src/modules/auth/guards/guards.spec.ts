import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { TEST_ENV } from '../../../testing/test-env';
import { AuthenticatedGuard } from './authenticated.guard';
import { CsrfGuard } from './csrf.guard';

const TOKEN = 'a'.repeat(43);

function contextFor(request: Record<string, unknown>, handler: object = {}) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function csrfRequest(method: string, options: { header?: string; origin?: string; sessionToken?: string | null } = {}) {
  const headers: Record<string, string | undefined> = { 'x-csrf-token': options.header, origin: options.origin };
  return {
    method,
    headers,
    get: (name: string) => headers[name.toLowerCase()],
    session: options.sessionToken === null ? {} : { csrfToken: options.sessionToken ?? TOKEN },
  };
}

describe('CsrfGuard', () => {
  const guard = new CsrfGuard({ frontendOrigin: TEST_ENV.FRONTEND_URL } as ConstructorParameters<typeof CsrfGuard>[0]);
  const check = (request: object) => guard.canActivate(contextFor(request as Record<string, unknown>));

  it.each(['GET', 'HEAD', 'OPTIONS'])('does not require a token for safe %s requests', (method) => {
    expect(check(csrfRequest(method))).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('requires the session token for %s requests', (method) => {
    expect(() => check(csrfRequest(method))).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => check(csrfRequest(method, { header: 'b'.repeat(43) }))).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    expect(check(csrfRequest(method, { header: TOKEN }))).toBe(true);
  });

  it('rejects a token when the session has none (e.g. signed out or expired)', () => {
    expect(() => check(csrfRequest('POST', { header: TOKEN, sessionToken: null }))).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });

  it('rejects tokens of a different length without error', () => {
    expect(() => check(csrfRequest('POST', { header: 'short' }))).toThrow(expect.objectContaining({ status: 403 }));
  });

  it('rejects a foreign Origin even with the right token, and accepts the frontend origin or none', () => {
    expect(() => check(csrfRequest('POST', { header: TOKEN, origin: 'http://evil.example' }))).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'CSRF_ORIGIN_MISMATCH' }) }),
    );
    expect(check(csrfRequest('POST', { header: TOKEN, origin: TEST_ENV.FRONTEND_URL }))).toBe(true);
    expect(check(csrfRequest('POST', { header: TOKEN }))).toBe(true);
  });
});

describe('AuthenticatedGuard', () => {
  const handler = {};
  const reflectorWith = (isPublic: boolean | undefined) =>
    ({ getAllAndOverride: jest.fn().mockReturnValue(isPublic) }) as unknown as Reflector;

  it('denies by default when there is no signed-in user', () => {
    const guard = new AuthenticatedGuard(reflectorWith(undefined));
    expect(() => guard.canActivate(contextFor({ session: {} }, handler))).toThrow(
      expect.objectContaining({ status: 401, response: expect.objectContaining({ code: 'UNAUTHENTICATED' }) }),
    );
    expect(() => guard.canActivate(contextFor({}, handler))).toThrow(expect.objectContaining({ status: 401 }));
  });

  it('allows a signed-in user', () => {
    const guard = new AuthenticatedGuard(reflectorWith(undefined));
    expect(guard.canActivate(contextFor({ session: { user: { id: '1' } } }, handler))).toBe(true);
  });

  it('allows routes explicitly marked @Public()', () => {
    const guard = new AuthenticatedGuard(reflectorWith(true));
    expect(guard.canActivate(contextFor({ session: {} }, handler))).toBe(true);
  });
});
