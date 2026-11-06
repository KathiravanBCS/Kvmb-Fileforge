/** Shared contracts for the HTTP layer. Feature-specific response shapes live in each feature's `types.ts`. */

/**
 * The standard envelope. FileForge-Api does NOT use it today (it answers with the bare DTO), so
 * `ApiClient` never unwraps it: an endpoint that does use it is typed `get<ApiResponse<Foo>>()`,
 * which keeps `meta` (pagination) reachable.
 */
export interface ApiResponse<T> {
  data: T;
  timestamp: string;
  requestId: string;
  meta?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export function isApiResponse(body: unknown): body is ApiResponse<unknown> {
  return typeof body === 'object' && body !== null && 'data' in body && 'timestamp' in body && 'requestId' in body;
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

type QueryPrimitive = string | number | boolean;

/** `undefined` and `null` are dropped; arrays become repeated keys (`a=1&a=2`). */
export type QueryParams = Record<string, QueryPrimitive | QueryPrimitive[] | null | undefined>;

export interface ServiceConfig {
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export interface RequestOptions {
  params?: QueryParams;
  headers?: Record<string, string>;
  /** Cancels the request, e.g. the `signal` TanStack Query passes to a query function. */
  signal?: AbortSignal;
  timeout?: number;
  /** Fetch a CSRF token and send it. Defaults to `true` for POST/PUT/PATCH/DELETE and uploads, `false` for GET. */
  csrf?: boolean;
}

export interface UploadOptions extends RequestOptions {
  /** 0 to 1 */
  onProgress?: (fraction: number) => void;
  /** Defaults to POST. PUT replaces the content of an existing resource. */
  method?: 'post' | 'put';
}

export class ApiError extends Error {
  readonly status: number | null;
  /** The API's stable error code (e.g. `ONEDRIVE_CONSENT_REQUIRED`), when the response carried one. */
  readonly code: string | null;
  readonly isNetworkError: boolean;
  /** Per-field problems, when the API sends them. */
  readonly errors: ValidationError[];
  /** The server's request id, for support and log correlation. */
  readonly requestId: string | null;
  /** On a 429: how many seconds to wait before trying again (from the body or the Retry-After header). */
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    options: {
      status?: number | null;
      code?: string | null;
      isNetworkError?: boolean;
      errors?: ValidationError[];
      requestId?: string | null;
      retryAfterSeconds?: number | null;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ApiError';
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.isNetworkError = options.isNetworkError ?? false;
    this.errors = options.errors ?? [];
    this.requestId = options.requestId ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}
