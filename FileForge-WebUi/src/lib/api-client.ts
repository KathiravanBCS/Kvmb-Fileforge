import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';

import { env } from '@/config/env';
import { API_ENDPOINTS } from './api-endpoints';
import {
  ApiError,
  type QueryParams,
  type RequestOptions,
  type ServiceConfig,
  type UploadOptions,
  type ValidationError,
} from './api-types';
import { SESSION_ENDED_CODE, notifySessionEnded } from './auth/session';

// Every endpoint lives under /api/v1 (FileForge-Api global prefix). VITE_API_BASE_URL is only the origin;
// taking `.origin` also keeps this correct if someone puts a path or trailing slash in it.
export const API_URL = `${new URL(env.VITE_API_BASE_URL).origin}/api/v1`;

const CSRF_HEADER = 'X-CSRF-Token';
const DEFAULT_TIMEOUT_MS = 15_000;
const TRANSFER_TIMEOUT_MS = 120_000;

// A 401 from these is expected (no session yet / already signed out), not "your session ended".
const SESSION_PROBES: readonly string[] = [API_ENDPOINTS.auth.me, API_ENDPOINTS.auth.logout];

function serializeParams(params: QueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, String(item));
  }
  return search.toString();
}

// The API answers errors as { error: { code, message, requestId } }.
function readErrorBody(data: unknown): {
  code: string | null;
  message: string | null;
  requestId: string | null;
  retryAfterSeconds: number | null;
  errors: ValidationError[];
} {
  const empty = { code: null, message: null, requestId: null, retryAfterSeconds: null, errors: [] };
  if (typeof data !== 'object' || data === null || !('error' in data)) return empty;
  const { error } = data;
  if (typeof error !== 'object' || error === null) return empty;

  const field = (key: string) => {
    const value = (error as Record<string, unknown>)[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
  const rawErrors = (error as Record<string, unknown>).errors;
  const errors = Array.isArray(rawErrors)
    ? rawErrors.flatMap((item): ValidationError[] =>
        typeof item === 'object' && item !== null && typeof item.field === 'string' && typeof item.message === 'string'
          ? [{ field: item.field, message: item.message }]
          : [],
      )
    : [];
  const wait = (error as Record<string, unknown>).retryAfterSeconds;
  return {
    code: field('code'),
    message: field('message'),
    requestId: field('requestId'),
    retryAfterSeconds: typeof wait === 'number' ? wait : null,
    errors,
  };
}

/** A wait time we are willing to act on: a whole number of seconds, at least 1, at most a day. Anything else is ignored. */
export function parseRetryAfter(...candidates: unknown[]): number | null {
  for (const candidate of candidates) {
    const seconds = typeof candidate === 'string' && /^\d{1,6}$/.test(candidate.trim()) ? Number(candidate) : candidate;
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(Math.max(Math.ceil(seconds), 1), 86_400);
    }
  }
  return null;
}

/** Error bodies of blob requests arrive as a Blob; read the JSON out of it so the real message is not lost. */
async function readableErrorData(data: unknown): Promise<unknown> {
  if (!(data instanceof Blob)) return data;
  try {
    return JSON.parse(await data.text());
  } catch {
    return null;
  }
}

async function toApiError(error: unknown): Promise<ApiError> {
  if (error instanceof ApiError) return error;

  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return new ApiError('Unable to reach the FileForge API.', { isNetworkError: true, cause: error });
    }
    const { status } = error.response;
    const body = readErrorBody(await readableErrorData(error.response.data));
    return new ApiError(body.message ?? `Request failed with status ${status}.`, {
      status,
      code: body.code,
      requestId: body.requestId,
      // Only a 429 carries a wait time worth acting on; the body is preferred, the header is the fallback.
      retryAfterSeconds: status === 429 ? parseRetryAfter(body.retryAfterSeconds, error.response.headers?.['retry-after']) : null,
      errors: body.errors,
      cause: error,
    });
  }

  return new ApiError('An unexpected error occurred.', { cause: error });
}

/** Development-only trace of method, path, status and timing. Never headers, bodies, query strings or cookies. */
function trace(method: string, url: string, outcome: string, startedAt: number): void {
  if (import.meta.env.DEV) console.debug(`[api] ${method} ${url} → ${outcome} (${Math.round(performance.now() - startedAt)} ms)`);
}

export class ApiClient {
  private readonly http;

  constructor(config: ServiceConfig = {}) {
    this.http = axios.create({
      baseURL: config.baseURL ?? API_URL,
      timeout: config.timeout ?? DEFAULT_TIMEOUT_MS,
      // Authentication is the backend's HTTP-only session cookie. No Authorization header is ever attached:
      // the browser holds no API token, and Microsoft Graph tokens never leave the backend.
      withCredentials: true,
      headers: { Accept: 'application/json', ...config.headers },
      paramsSerializer: { serialize: serializeParams },
    });
  }

  /** One token per state-changing request, never stored anywhere in the browser. */
  private async csrfHeaders(signal: AbortSignal | undefined): Promise<Record<string, string>> {
    const { data } = await this.http.get<unknown>(API_ENDPOINTS.auth.csrf, { signal });
    const token = typeof data === 'object' && data !== null && 'csrfToken' in data ? data.csrfToken : null;
    if (typeof token !== 'string' || token.length === 0) {
      throw new ApiError(`The server returned an unexpected response for ${API_ENDPOINTS.auth.csrf}.`, { status: 200 });
    }
    return { [CSRF_HEADER]: token };
  }

  /** The single place every request goes through: CSRF, cancellation, error mapping, session-ended detection. */
  private async request<T>(config: AxiosRequestConfig & { url: string }, options: RequestOptions, csrfDefault: boolean): Promise<T> {
    const startedAt = performance.now();
    const method = (config.method ?? 'get').toUpperCase();
    try {
      const csrf = options.csrf ?? csrfDefault;
      const headers = { ...options.headers, ...(csrf ? await this.csrfHeaders(options.signal) : undefined) };
      const response: AxiosResponse<T> = await this.http.request<T>({
        ...config,
        headers,
        params: options.params,
        signal: options.signal,
        timeout: options.timeout ?? config.timeout,
      });
      trace(method, config.url, String(response.status), startedAt);
      // An empty body (204, or a blank 200) has nothing to parse.
      return (response.status === 204 || response.data === '' ? undefined : response.data) as T;
    } catch (error) {
      // A cancelled request is not a failure: let the caller (TanStack Query, an AbortController) see it as is.
      if (axios.isCancel(error)) throw error;

      const apiError = await toApiError(error);
      trace(method, config.url, apiError.status === null ? 'network error' : String(apiError.status), startedAt);
      if (apiError.status === 401 && apiError.code === SESSION_ENDED_CODE && !SESSION_PROBES.includes(config.url)) {
        notifySessionEnded();
      }
      throw apiError;
    }
  }

  get<T>(url: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>({ url, method: 'get' }, options, false);
  }

  post<T, D = unknown>(url: string, body?: D, options: RequestOptions = {}): Promise<T> {
    return this.request<T>({ url, method: 'post', data: body }, options, true);
  }

  put<T, D = unknown>(url: string, body?: D, options: RequestOptions = {}): Promise<T> {
    return this.request<T>({ url, method: 'put', data: body }, options, true);
  }

  patch<T, D = unknown>(url: string, body?: D, options: RequestOptions = {}): Promise<T> {
    return this.request<T>({ url, method: 'patch', data: body }, options, true);
  }

  delete<T>(url: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>({ url, method: 'delete' }, options, true);
  }

  /** Multipart upload. The browser sets the Content-Type (with its boundary), so none is sent here. */
  upload<T>(url: string, form: FormData, { onProgress, method = 'post', ...options }: UploadOptions = {}): Promise<T> {
    return this.request<T>(
      {
        url,
        method,
        data: form,
        timeout: TRANSFER_TIMEOUT_MS,
        onUploadProgress: onProgress && ((event) => onProgress(event.progress ?? 0)),
      },
      options,
      true,
    );
  }

  /** GET that returns the response bytes. Hand the result to `saveBlob` to offer it as a download. */
  download(url: string, options: RequestOptions = {}): Promise<Blob> {
    return this.request<Blob>({ url, method: 'get', responseType: 'blob', timeout: TRANSFER_TIMEOUT_MS }, options, false);
  }

  /** POST that returns bytes (e.g. generate and download a report). */
  postBlob<D = unknown>(url: string, body?: D, options: RequestOptions = {}): Promise<Blob> {
    return this.request<Blob>(
      { url, method: 'post', data: body, responseType: 'blob', timeout: TRANSFER_TIMEOUT_MS },
      options,
      true,
    );
  }
}

export const apiClient = new ApiClient();
