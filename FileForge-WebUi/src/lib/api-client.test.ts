import axios, { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient, parseRetryAfter } from './api-client';
import { ApiError } from './api-types';

// Only HTTP is replaced: the client's own error mapping is what these tests are about.
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, create: vi.fn() } };
});

const request = vi.fn();
const getMock = vi.fn();

function failure(status: number, data: unknown, headers: Record<string, string> = {}) {
  return new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    statusText: '',
    data,
    headers,
    config: { headers: new AxiosHeaders() },
  });
}
const body = (error: Record<string, unknown>) => ({ error: { message: 'm', code: 'C', requestId: 'req-1', ...error } });

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('expected a rejection');
}

let client: ApiClient;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(axios.create).mockReturnValue({ request, get: getMock } as never);
  client = new ApiClient();
});

describe('429 handling', () => {
  it('reads the wait time from the error body', async () => {
    request.mockRejectedValue(failure(429, body({ code: 'UPLOAD_RATE_LIMITED', retryAfterSeconds: 300 })));
    const error = await rejection(client.get('/x'));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: 'UPLOAD_RATE_LIMITED', requestId: 'req-1', retryAfterSeconds: 300 });
  });

  it('falls back to the Retry-After header', async () => {
    request.mockRejectedValue(failure(429, body({}), { 'retry-after': '45' }));
    expect((await rejection(client.get('/x'))).retryAfterSeconds).toBe(45);
  });

  it('prefers the body over the header', async () => {
    request.mockRejectedValue(failure(429, body({ retryAfterSeconds: 10 }), { 'retry-after': '99' }));
    expect((await rejection(client.get('/x'))).retryAfterSeconds).toBe(10);
  });

  it('ignores a wait time it cannot use (an HTTP date, garbage, a negative number)', async () => {
    for (const header of ['Wed, 21 Oct 2026 07:28:00 GMT', 'soon', '-5', '1e9', '12345678']) {
      request.mockRejectedValue(failure(429, body({}), { 'retry-after': header }));
      expect((await rejection(client.get('/x'))).retryAfterSeconds).toBeNull();
    }
  });

  it('only a 429 carries a wait time', async () => {
    request.mockRejectedValue(failure(503, body({ retryAfterSeconds: 30 }), { 'retry-after': '30' }));
    expect((await rejection(client.get('/x'))).retryAfterSeconds).toBeNull();
  });

  it('a 429 without any wait time is still a normal ApiError', async () => {
    request.mockRejectedValue(failure(429, body({ code: 'CENTRAL_STORAGE_THROTTLED' })));
    expect(await rejection(client.get('/x'))).toMatchObject({ status: 429, retryAfterSeconds: null });
  });

  it('does not treat a 429 as an ended session', async () => {
    request.mockRejectedValue(failure(429, body({ code: 'UNAUTHENTICATED' })));
    // A 429 is never "your session ended": only a 401 may sign the user out.
    expect((await rejection(client.get('/x'))).status).toBe(429);
  });
});

describe('parseRetryAfter', () => {
  it.each([
    [[30], 30],
    [['30'], 30],
    [[' 30 '], 30],
    [[0], 1],
    [[0.2], 1],
    [[2.1], 3],
    [[10 ** 9], 86_400],
    [[undefined, null, '7'], 7],
    [[NaN, 'x', 4], 4],
    [[], null],
    [[undefined, 'nope'], null],
    [[-1], null],
  ])('%j -> %j', (candidates, expected) => {
    expect(parseRetryAfter(...(candidates as unknown[]))).toBe(expected);
  });
});
