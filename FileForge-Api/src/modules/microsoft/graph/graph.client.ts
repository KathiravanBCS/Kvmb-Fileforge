import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import authConfig from '../../../config/auth.config';
import { MicrosoftIdentityService } from '../identity/microsoft-identity.service';
import type { TokenCacheStore } from '../identity/microsoft-identity.types';
import { MicrosoftApiError } from '../microsoft.errors';

/** Whose Microsoft account to call Graph as: the caller's own delegated, per-session credentials. */
export interface GraphRequestContext {
  cache: TokenCacheStore;
  homeAccountId: string;
}

export interface GraphRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: BodyInit;
  headers?: Record<string, string>;
  /** Request only what this operation needs; add more via incremental consent. */
  scopes?: string[];
}

const DEFAULT_SCOPES = ['User.Read'];

/**
 * Minimal delegated Microsoft Graph client. Only the building blocks for Phase 1E: token acquisition and
 * renewal, error mapping and a safe request helper. There are no OneDrive operations here yet.
 */
@Injectable()
export class GraphClient {
  constructor(
    private readonly identity: MicrosoftIdentityService,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  /** JSON request. Resolves to undefined for 204 No Content. */
  async request<T = unknown>(
    context: GraphRequestContext,
    path: string,
    options: GraphRequestOptions = {},
  ): Promise<T | undefined> {
    const response = await this.requestRaw(context, path, options);
    return response.status === 204 ? undefined : ((await response.json()) as T);
  }

  /**
   * Same request and error handling, but returns the successful Response untouched (for streaming a download).
   * fetch follows Graph's redirect to the file host and drops the Authorization header when the origin changes.
   */
  async requestRaw(context: GraphRequestContext, path: string, options: GraphRequestOptions = {}): Promise<Response> {
    const url = this.buildUrl(path);
    const scopes = options.scopes ?? DEFAULT_SCOPES;

    let response = await this.send(url, await this.token(context, scopes, false), options);
    if (response.status === 401) {
      // The access token may have been revoked or have expired early: renew once, then give up.
      response = await this.send(url, await this.token(context, scopes, true), options);
    }
    if (!response.ok) throw await this.toError(response);
    return response;
  }

  /**
   * Turns an absolute Graph link (e.g. `@odata.nextLink`) into a path for `request`.
   * Anything that is not under the configured Graph base is refused, so a link cannot redirect the bearer token.
   */
  pathFromLink(link: string): string {
    const base = new URL(this.config.microsoft.graphBaseUrl);
    const basePath = base.pathname.replace(/\/$/, '');
    const url = new URL(link);
    if (url.origin !== base.origin || !url.pathname.startsWith(`${basePath}/`)) {
      throw new Error('Link is not under the Graph base URL.');
    }
    return `${url.pathname.slice(basePath.length)}${url.search}`;
  }

  /**
   * Only paths under the configured Graph base (host AND version prefix) are allowed, so a bearer token can
   * never be sent to another host and `..` segments cannot climb out of /v1.0 (e.g. into /beta).
   */
  private buildUrl(path: string): URL {
    const base = new URL(this.config.microsoft.graphBaseUrl);
    const basePath = base.pathname.replace(/\/$/, '');
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Graph path must start with a single "/".');
    const url = new URL(`${basePath}${path}`, base.origin);
    if (url.origin !== base.origin || !url.pathname.startsWith(`${basePath}/`)) {
      throw new Error('Graph path must stay under the Graph base URL.');
    }
    return url;
  }

  private async token(context: GraphRequestContext, scopes: string[], forceRefresh: boolean): Promise<string> {
    const { accessToken } = await this.identity.acquireTokenSilent({ ...context, scopes, forceRefresh });
    return accessToken;
  }

  private async send(url: URL, accessToken: string, options: GraphRequestOptions): Promise<Response> {
    try {
      return await fetch(url, {
        method: options.method ?? 'GET',
        body: options.body,
        headers: { Accept: 'application/json', ...options.headers, Authorization: `Bearer ${accessToken}` },
      });
    } catch (error) {
      throw new MicrosoftApiError('unavailable', { cause: error });
    }
  }

  private async toError(response: Response): Promise<MicrosoftApiError> {
    const status = response.status;
    // Keep only Graph's short error code. Never the message or body: they can echo user data.
    const body = (await response.json().catch(() => null)) as { error?: { code?: unknown } } | null;
    const graphCode = typeof body?.error?.code === 'string' ? body.error.code : undefined;

    if (status === 401) return new MicrosoftApiError('reauth_required', { status, graphCode });
    if (status === 403) return new MicrosoftApiError('forbidden', { status, graphCode });
    if (status === 404) return new MicrosoftApiError('not_found', { status, graphCode });
    if (status === 409) return new MicrosoftApiError('conflict', { status, graphCode });
    if (status === 429 || status === 503) {
      const retryAfter = Number(response.headers.get('retry-after'));
      return new MicrosoftApiError('throttled', {
        status,
        graphCode,
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      });
    }
    return new MicrosoftApiError(status >= 500 ? 'unavailable' : 'unknown', { status, graphCode });
  }
}
