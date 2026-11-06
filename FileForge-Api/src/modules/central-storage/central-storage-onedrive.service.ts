import { open, readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebStream } from 'node:stream/web';

import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';

import { describeError } from '../../common/utils/logging.util';
import { GraphClient, type GraphRequestContext } from '../microsoft/graph/graph.client';
import { MicrosoftApiError, type MicrosoftErrorKind } from '../microsoft/microsoft.errors';
import { FILES_SCOPE } from '../storage/onedrive/onedrive.constants';
import type { GraphDriveItem } from '../storage/onedrive/onedrive.types';
import { ancestryUnder } from '../storage/storage-roots';
import { isQuotaError, withCentralGraphErrors } from './central-storage-errors';
import {
  CENTRAL_ROOT_FOLDER_NAME,
  CENTRAL_USERS_FOLDER_NAME,
  GRAPH_MAX_ATTEMPTS,
  GRAPH_RETRY_BASE_MS,
  GRAPH_RETRY_MAX_WAIT_MS,
  SIMPLE_UPLOAD_MAX_BYTES,
  UPLOAD_CHUNK_BYTES,
} from './central-storage.constants';
import { CentralTokenVault } from './central-token-vault.service';
import type { CentralLayout, DriveQuota, UsableCentralConnection } from './types/central-storage.types';

const GRAPH = { scopes: [FILES_SCOPE] };
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const ITEM_SELECT = '$select=id,name,size,eTag,cTag,file,folder,parentReference,createdDateTime,lastModifiedDateTime';
const enc = encodeURIComponent;

export interface UploadSource {
  /** Local temporary file. Read in bounded chunks; never loaded whole except for files up to 4 MB. */
  path: string;
  size: number;
}

/**
 * Every Microsoft Graph call central storage makes, always as the central OneDrive account and always inside
 * `FileForge-Central`. Item ids come from PostgreSQL; the browser never supplies a drive id, item id or path.
 *
 * Retries are bounded and only for calls that are safe to repeat (reads, deletes, chunk uploads at an explicit range).
 * Creating an item is never retried blindly: the file might already exist.
 */
@Injectable()
export class CentralStorageOneDriveService {
  private readonly logger = new Logger(CentralStorageOneDriveService.name);
  /** `connection:drive:user` -> OneDrive folder id of `users/<userId>`; only a cache, verified by use. */
  private readonly userFolders = new Map<string, string>();
  /** Replaced in tests so retries do not really wait. */
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  constructor(
    private readonly vault: CentralTokenVault,
    private readonly graph: GraphClient,
  ) {}

  usableConnection(): Promise<UsableCentralConnection> {
    return this.vault.usableConnection();
  }

  /** Uploads a NEW item `users/<ownerId>/<storedName>`. conflictBehavior=fail: it can never overwrite anything. */
  uploadNew(ownerId: bigint, storedName: string, file: UploadSource, signal?: AbortSignal): Promise<GraphDriveItem> {
    return withCentralGraphErrors(() =>
      this.vault.withGraph(async ({ graph, connection }) => {
        const create = async (folderId: string) => {
          const base = `/drives/${enc(connection.driveId)}/items/${enc(folderId)}:/${enc(storedName)}:`;
          return file.size <= SIMPLE_UPLOAD_MAX_BYTES
            ? this.putSimple(graph, `${base}/content?@microsoft.graph.conflictBehavior=fail`, file)
            : this.putSession(
                graph,
                `${base}/createUploadSession`,
                { item: { '@microsoft.graph.conflictBehavior': 'fail' } },
                file,
                signal,
              );
        };

        const cacheKey = `${connection.id}:${connection.driveId}:${ownerId}`;
        const cached = this.userFolders.get(cacheKey);
        let item: GraphDriveItem;
        try {
          item = await create(cached ?? (await this.userFolderId(graph, connection, ownerId)));
        } catch (error) {
          // The cached folder may have been removed in OneDrive: forget it and try once with a freshly resolved one.
          if (cached && error instanceof MicrosoftApiError && error.kind === 'not_found') {
            this.userFolders.delete(cacheKey);
            item = await create(await this.userFolderId(graph, connection, ownerId));
          } else {
            throw error;
          }
        }
        this.assertCentralItem(item, connection);
        return item;
      }),
    );
  }

  /** Replaces the content of an existing item. The old content stays valid until the new upload completes. */
  replaceContent(itemId: string, file: UploadSource, signal?: AbortSignal): Promise<GraphDriveItem> {
    return withCentralGraphErrors(() =>
      this.vault.withGraph(async ({ graph, connection }) => {
        const base = `/drives/${enc(connection.driveId)}/items/${enc(itemId)}`;
        const item =
          file.size <= SIMPLE_UPLOAD_MAX_BYTES
            ? await this.putSimple(graph, `${base}/content`, file)
            : await this.putSession(
                graph,
                `${base}/createUploadSession`,
                { item: { '@microsoft.graph.conflictBehavior': 'replace' } },
                file,
                signal,
              );
        this.assertCentralItem(item, connection);
        return item;
      }),
    );
  }

  /** The file bytes as a stream. The caller is responsible for authorization before calling this. */
  download(itemId: string): Promise<Readable> {
    return withCentralGraphErrors(() =>
      this.vault.withGraph(async ({ graph, connection }) => {
        const response = await this.retry(() =>
          this.graph.requestRaw(graph, `/drives/${enc(connection.driveId)}/items/${enc(itemId)}/content`, {
            ...GRAPH,
            headers: { Accept: '*/*' },
          }),
        );
        if (!response.body) {
          throw new BadGatewayException({
            code: 'CENTRAL_STORAGE_ERROR',
            message: 'File storage returned an empty response.',
          });
        }
        return Readable.fromWeb(response.body as unknown as NodeWebStream);
      }),
    );
  }

  /** Deletes the item (OneDrive recycle bin). Already gone counts as deleted. */
  deleteItem(itemId: string): Promise<void> {
    return withCentralGraphErrors(() =>
      this.vault.withGraph(async ({ graph, connection }) => {
        try {
          await this.retry(() =>
            this.graph.request(graph, `/drives/${enc(connection.driveId)}/items/${enc(itemId)}`, {
              ...GRAPH,
              method: 'DELETE',
            }),
          );
        } catch (error) {
          if (!(error instanceof MicrosoftApiError && error.kind === 'not_found')) throw error;
        }
      }),
    );
  }

  /** Current OneDrive metadata of an item; refuses anything outside the central root. */
  getItem(itemId: string): Promise<GraphDriveItem> {
    return withCentralGraphErrors(() =>
      this.vault.withGraph(async ({ graph, connection }) => {
        const item = await this.retry(() =>
          this.graph.request<GraphDriveItem>(
            graph,
            `/drives/${enc(connection.driveId)}/items/${enc(itemId)}?${ITEM_SELECT}`,
            GRAPH,
          ),
        );
        if (!item?.id) throw new MicrosoftApiError('not_found');
        this.assertCentralItem(item, connection);
        return item;
      }),
    );
  }

  /** Like getItem, but "not there" is `null` (recovery needs to tell a missing item from a failing call). */
  findItem(itemId: string): Promise<GraphDriveItem | null> {
    return withCentralGraphErrors(() =>
      this.vault.withGraph(async ({ graph, connection }) =>
        this.readOrNull(connection, () =>
          this.graph.request<GraphDriveItem>(
            graph,
            `/drives/${enc(connection.driveId)}/items/${enc(itemId)}?${ITEM_SELECT}`,
            GRAPH,
          ),
        ),
      ),
    );
  }

  /**
   * The item at `users/<ownerId>/<storedName>`, or `null`. The stored name is generated by this server, so the path of an
   * upload is known even when the database never learned the item id (an interrupted upload).
   */
  findUserFile(ownerId: bigint, storedName: string): Promise<GraphDriveItem | null> {
    return withCentralGraphErrors(() =>
      this.vault.withGraph(async ({ graph, connection }) =>
        this.readOrNull(connection, () =>
          this.graph.request<GraphDriveItem>(
            graph,
            `/drives/${enc(connection.driveId)}/items/${enc(connection.usersFolderItemId)}:/${enc(ownerId.toString())}/${enc(storedName)}?${ITEM_SELECT}`,
            GRAPH,
          ),
        ),
      ),
    );
  }

  /** Health check: the drive answers, the central root still exists, and the quota. */
  health(): Promise<DriveQuota> {
    return withCentralGraphErrors(() =>
      this.vault.withGraph(async ({ graph, connection }) => {
        const drive = await this.retry(() =>
          this.graph.request<{ quota?: { total?: number; used?: number; remaining?: number; state?: string } }>(
            graph,
            `/drives/${enc(connection.driveId)}?$select=id,quota`,
            GRAPH,
          ),
        );
        const root = await this.retry(() =>
          this.graph.request<GraphDriveItem>(
            graph,
            `/drives/${enc(connection.driveId)}/items/${enc(connection.rootItemId)}?$select=id,folder`,
            GRAPH,
          ),
        );
        if (!root?.folder) throw new MicrosoftApiError('not_found');
        const quota = drive?.quota;
        return {
          total: quota?.total ?? null,
          used: quota?.used ?? null,
          remaining: quota?.remaining ?? null,
          state: quota?.state ?? null,
        };
      }),
    );
  }

  /** Finds or creates `FileForge-Central/` and `FileForge-Central/users/`. Nothing else in the drive is touched. */
  async ensureLayout(context: GraphRequestContext): Promise<CentralLayout> {
    const drive = await this.graph.request<{ id?: string }>(context, '/me/drive', GRAPH);
    if (!drive?.id) throw new MicrosoftApiError('unknown');
    const driveId = drive.id;
    const base = `/drives/${enc(driveId)}`;

    const root = await this.ensureFolder(
      context,
      driveId,
      `${base}/root:/${enc(CENTRAL_ROOT_FOLDER_NAME)}`,
      `${base}/root/children`,
      CENTRAL_ROOT_FOLDER_NAME,
    );
    const users = await this.ensureFolder(
      context,
      driveId,
      `${base}/items/${enc(root.id)}:/${enc(CENTRAL_USERS_FOLDER_NAME)}`,
      `${base}/items/${enc(root.id)}/children`,
      CENTRAL_USERS_FOLDER_NAME,
    );
    return { driveId, rootItemId: root.id, usersFolderItemId: users.id };
  }

  // ----- internals -------------------------------------------------------------------------------------------------

  private async readOrNull(
    connection: UsableCentralConnection,
    read: () => Promise<GraphDriveItem | undefined>,
  ): Promise<GraphDriveItem | null> {
    try {
      const item = await this.retry(read);
      if (!item?.id) return null;
      this.assertCentralItem(item, connection);
      return item;
    } catch (error) {
      if (error instanceof MicrosoftApiError && error.kind === 'not_found') return null;
      throw error;
    }
  }

  /** `users/<ownerId>`: the owner's folder, created on first use. The name is the database user id, never an e-mail. */
  private async userFolderId(
    graph: GraphRequestContext,
    connection: UsableCentralConnection,
    ownerId: bigint,
  ): Promise<string> {
    const base = `/drives/${enc(connection.driveId)}/items/${enc(connection.usersFolderItemId)}`;
    const folder = await this.ensureFolder(
      graph,
      connection.driveId,
      `${base}:/${enc(ownerId.toString())}`,
      `${base}/children`,
      ownerId.toString(),
    );
    this.userFolders.set(`${connection.id}:${connection.driveId}:${ownerId}`, folder.id);
    return folder.id;
  }

  private async ensureFolder(
    context: GraphRequestContext,
    driveId: string,
    getPath: string,
    childrenPath: string,
    name: string,
  ): Promise<GraphDriveItem> {
    const read = () => this.graph.request<GraphDriveItem>(context, getPath, GRAPH);
    let item: GraphDriveItem | undefined;
    try {
      item = await this.retry(read);
    } catch (error) {
      if (!(error instanceof MicrosoftApiError) || error.kind !== 'not_found') throw error;
      try {
        item = await this.graph.request<GraphDriveItem>(context, childrenPath, {
          ...GRAPH,
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
        });
      } catch (createError) {
        // Created by a concurrent request a moment ago: that is fine, read it.
        if (!(createError instanceof MicrosoftApiError) || createError.kind !== 'conflict') throw createError;
        item = await this.retry(read);
      }
    }
    // Something that is not a folder (e.g. a FILE with that name), or not in this drive, is never adopted.
    if (!item?.id || !item.folder || (item.parentReference?.driveId && item.parentReference.driveId !== driveId)) {
      throw new MicrosoftApiError('unknown');
    }
    return item;
  }

  /** Fail closed: an item outside this drive, a shortcut, or one that is not inside `FileForge-Central` is never used. */
  private assertCentralItem(item: GraphDriveItem, connection: UsableCentralConnection): void {
    const wrongDrive =
      item.parentReference?.driveId !== undefined && item.parentReference.driveId !== connection.driveId;
    const outside = ancestryUnder(item.parentReference?.path, CENTRAL_ROOT_FOLDER_NAME) === 'outside';
    if (!item.id || item.remoteItem || wrongDrive || outside) {
      throw new MicrosoftApiError('forbidden');
    }
  }

  private async putSimple(graph: GraphRequestContext, path: string, file: UploadSource): Promise<GraphDriveItem> {
    const body = await readFile(file.path);
    const item = await this.graph.request<GraphDriveItem>(graph, path, {
      ...GRAPH,
      method: 'PUT',
      body: new Uint8Array(body),
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    if (!item?.id) throw new MicrosoftApiError('unknown');
    return item;
  }

  private async putSession(
    graph: GraphRequestContext,
    path: string,
    payload: unknown,
    file: UploadSource,
    signal?: AbortSignal,
  ): Promise<GraphDriveItem> {
    const session = await this.graph.request<{ uploadUrl?: string }>(graph, path, {
      ...GRAPH,
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    });
    if (!session?.uploadUrl) throw new MicrosoftApiError('unknown');
    return this.uploadChunks(session.uploadUrl, file, signal);
  }

  /**
   * Graph upload session: sequential chunks of UPLOAD_CHUNK_BYTES read from the temporary file (bounded memory).
   * The upload URL is pre-authenticated, so it is called WITHOUT the access token. After a transient failure the session
   * is asked where it stands and the upload resumes from there. Any final failure cancels the session so nothing is left.
   */
  private async uploadChunks(uploadUrl: string, file: UploadSource, signal?: AbortSignal): Promise<GraphDriveItem> {
    assertUploadUrl(uploadUrl);
    const handle = await open(file.path, 'r');
    try {
      let offset = 0;
      let failures = 0;
      // Hard stop against a misbehaving server that keeps answering "send it again".
      const maxRequests = Math.ceil(file.size / UPLOAD_CHUNK_BYTES) + GRAPH_MAX_ATTEMPTS * 2;
      for (let request = 0; request < maxRequests; request++) {
        if (signal?.aborted) {
          throw new BadRequestException({ code: 'UPLOAD_CANCELLED', message: 'The upload was cancelled.' });
        }
        const length = Math.min(UPLOAD_CHUNK_BYTES, file.size - offset);
        const chunk = Buffer.alloc(length);
        await handle.read(chunk, 0, length, offset);

        let response: Response | undefined;
        try {
          response = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Length': String(length),
              'Content-Range': `bytes ${offset}-${offset + length - 1}/${file.size}`,
            },
            body: new Uint8Array(chunk),
          });
        } catch {
          response = undefined; // network failure: treated like a transient server error
        }

        if (response && (response.status === 200 || response.status === 201)) {
          const item = (await response.json().catch(() => null)) as GraphDriveItem | null;
          if (!item?.id) throw new MicrosoftApiError('unknown');
          return item;
        }
        if (response?.status === 202) {
          const next = nextExpectedStart(
            (await response.json().catch(() => null)) as { nextExpectedRanges?: string[] } | null,
          );
          if (next === null || next > file.size) throw new MicrosoftApiError('unknown');
          offset = next;
          failures = 0;
          continue;
        }

        const body = response
          ? ((await response.json().catch(() => null)) as { error?: { code?: unknown } } | null)
          : null;
        const graphCode = typeof body?.error?.code === 'string' ? body.error.code : undefined;
        const status = response?.status;
        const failure = new MicrosoftApiError(kindForUploadStatus(status), { status, graphCode });
        if (isQuotaError(failure)) throw failure;

        const transient = status === undefined || status === 429 || status >= 500 || status === 416;
        if (!transient || ++failures >= GRAPH_MAX_ATTEMPTS) throw failure;
        await this.wait(backoffMs(failures, response ? Number(response.headers.get('retry-after')) : 0));
        offset = (await this.resumePoint(uploadUrl)) ?? offset;
      }
      throw new MicrosoftApiError('unknown');
    } catch (error) {
      await this.cancelSession(uploadUrl);
      throw error;
    } finally {
      await handle.close();
    }
  }

  /** Where the session expects the next byte, or null when it cannot be asked. */
  private async resumePoint(uploadUrl: string): Promise<number | null> {
    try {
      const response = await fetch(uploadUrl, { method: 'GET' });
      if (!response.ok) return null;
      return nextExpectedStart((await response.json().catch(() => null)) as { nextExpectedRanges?: string[] } | null);
    } catch {
      return null;
    }
  }

  private async cancelSession(uploadUrl: string): Promise<void> {
    try {
      await fetch(uploadUrl, { method: 'DELETE' });
    } catch (error) {
      this.logger.warn({ event: 'central_upload_session_cancel_failed', error: describeError(error) });
    }
  }

  private async retry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const retryable =
          error instanceof MicrosoftApiError &&
          (error.kind === 'throttled' || error.kind === 'unavailable') &&
          !isQuotaError(error);
        if (!retryable || attempt >= GRAPH_MAX_ATTEMPTS) throw error;
        await this.wait(backoffMs(attempt, error.retryAfterSeconds ?? 0));
      }
    }
  }
}

/** The pre-authenticated upload URL comes from Graph; still it must be https and a real host, never a raw IP or localhost. */
export function assertUploadUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MicrosoftApiError('unknown');
  }
  const host = url.hostname.toLowerCase();
  const rawIp = /^[\d.]+$/.test(host) || host.includes(':');
  if (url.protocol !== 'https:' || url.username || url.password || host === 'localhost' || rawIp) {
    throw new MicrosoftApiError('unknown');
  }
}

/** `["26-"]` or `["26-100"]` -> 26. */
function nextExpectedStart(body: { nextExpectedRanges?: string[] } | null): number | null {
  const first = body?.nextExpectedRanges?.[0];
  const start = first === undefined ? NaN : Number(first.split('-')[0]);
  return Number.isInteger(start) && start >= 0 ? start : null;
}

function kindForUploadStatus(status: number | undefined): MicrosoftErrorKind {
  if (status === undefined) return 'unavailable';
  if (status === 409) return 'conflict';
  if (status === 429) return 'throttled';
  if (status >= 500) return 'unavailable';
  if (status === 401 || status === 403) return 'forbidden';
  // 404 here means the upload session expired or was cancelled.
  return status === 404 ? 'unavailable' : 'unknown';
}

function backoffMs(attempt: number, retryAfterSeconds: number): number {
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, GRAPH_RETRY_MAX_WAIT_MS);
  }
  return Math.min(GRAPH_RETRY_BASE_MS * 2 ** (attempt - 1), GRAPH_RETRY_MAX_WAIT_MS);
}
