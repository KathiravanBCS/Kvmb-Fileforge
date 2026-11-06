import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebStream } from 'node:stream/web';

import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import type { SessionUser } from '../../../common/types/session.types';
import { describeError } from '../../../common/utils/logging.util';
import { PrismaService } from '../../../prisma/prisma.service';
import { GraphClient, type GraphRequestContext } from '../../microsoft/graph/graph.client';
import { sessionTokenCache } from '../../microsoft/identity/session-token-cache';
import { MicrosoftApiError } from '../../microsoft/microsoft.errors';
import { ancestryUnder } from '../storage-roots';
import { OneDriveConnectionService, type StorageSession } from './onedrive-connection.service';
import { withGraphErrors } from './onedrive-errors';
import { assertAllowedFileName, assertUploadSize, itemPath, joinPath, parseRelativePath } from './onedrive-paths';
import { FILES_SCOPE, LIST_PAGE_SIZE, MAX_LIST_ITEMS, ROOT_FOLDER_NAME } from './onedrive.constants';
import type {
  GraphChildrenPage,
  GraphDriveItem,
  OneDriveItem,
  OneDriveListing,
  UsableConnection,
} from './onedrive.types';

export interface StorageRequestContext {
  workspaceId: string;
  user: SessionUser;
  session: StorageSession;
}

export interface DownloadedFile {
  stream: Readable;
  filename: string;
}

const GRAPH = { scopes: [FILES_SCOPE] };
/** Parent hops followed when Graph gives no ancestry path (paths are at most 10 deep). */
const MAX_ANCESTRY_DEPTH = 12;
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const LIST_SELECT = '$select=id,name,size,file,folder,lastModifiedDateTime,parentReference,remoteItem,package';

/**
 * File operations on the FileForge folder of the connection's OneDrive.
 *
 * Containment: the browser only ever supplies a path RELATIVE to the FileForge root. The drive id and root item id come
 * from the stored connection, every path segment is validated, and every item that is acted on must be in that drive.
 *
 * Consistency between OneDrive (contents, source of truth) and PostgreSQL (storage.files metadata):
 *  - upload:  OneDrive first, then metadata; if metadata fails the new file is removed again (it was created by this request).
 *  - rename:  OneDrive first, then metadata; if metadata fails the rename is reverted.
 *  - delete:  metadata soft-delete first (reversible), then OneDrive; if OneDrive fails the soft-delete is undone.
 */
@Injectable()
export class OneDriveFilesService {
  private readonly logger = new Logger(OneDriveFilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphClient,
    private readonly connections: OneDriveConnectionService,
  ) {}

  async list(ctx: StorageRequestContext, rawPath: unknown): Promise<OneDriveListing> {
    const segments = parseRelativePath(rawPath, { allowRoot: true });
    const connection = await this.connections.requireUsable(ctx.workspaceId, ctx.user);
    const graph = this.graphContext(ctx);

    return withGraphErrors(async () => {
      let path: string | undefined =
        `${itemPath(connection.driveId, connection.rootItemId, segments, '/children')}?$top=${LIST_PAGE_SIZE}&${LIST_SELECT}`;
      const items: OneDriveItem[] = [];
      let truncated = false;

      while (path) {
        const page: GraphChildrenPage | undefined = await this.graph.request<GraphChildrenPage>(graph, path, GRAPH);
        for (const child of page?.value ?? []) {
          const item = this.toItem(child, connection, segments);
          if (!item) continue;
          if (items.length >= MAX_LIST_ITEMS) {
            truncated = true;
            break;
          }
          items.push(item);
        }
        const next: string | undefined = page?.['@odata.nextLink'];
        if (truncated) break;
        // The next-page link is turned into a path that must stay under the Graph base, never fetched blindly.
        path = next ? this.graph.pathFromLink(next) : undefined;
      }

      items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
      return { path: joinPath(segments), items, truncated };
    });
  }

  async upload(
    ctx: StorageRequestContext,
    rawFolderPath: unknown,
    file: { name: string; buffer: Buffer } | undefined,
  ): Promise<OneDriveItem> {
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Choose a file to upload.' });
    assertAllowedFileName(file.name);
    assertUploadSize(file.buffer.length);
    const folder = parseRelativePath(rawFolderPath, { allowRoot: true });

    const connection = await this.connections.requireUsable(ctx.workspaceId, ctx.user);
    const graph = this.graphContext(ctx);

    const uploaded = await withGraphErrors(async () => {
      // Only existing folders: an upload never creates new folders, and never lands outside the root.
      const target = await this.getItem(graph, connection, folder);
      if (!target.folder) {
        throw new BadRequestException({ code: 'NOT_A_FOLDER', message: 'The upload target is not a folder.' });
      }
      const created = await this.graph.request<GraphDriveItem>(
        graph,
        // conflictBehavior=fail: an existing file is never overwritten, so this request always creates a NEW item.
        `${itemPath(connection.driveId, connection.rootItemId, [...folder, file.name], '/content')}?@microsoft.graph.conflictBehavior=fail`,
        // fetch's BodyInit wants an ArrayBuffer-backed view; the copy is at most MAX_UPLOAD_BYTES (4 MB).
        {
          ...GRAPH,
          method: 'PUT',
          body: new Uint8Array(file.buffer),
          headers: { 'Content-Type': 'application/octet-stream' },
        },
      );
      if (!created) throw new MicrosoftApiError('unknown');
      this.assertInDrive(created, connection);
      return created;
    });

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    try {
      await this.recordFile(ctx, connection, uploaded, [...folder, uploaded.name], sha256);
    } catch (error) {
      this.logger.error({ event: 'onedrive_metadata_failed', operation: 'upload', error: describeError(error) });
      // Compensate: the file exists only because of this request, so removing it restores the previous state.
      await this.removeQuietly(graph, connection, uploaded.id, 'upload');
      throw new ServiceUnavailableException({
        code: 'METADATA_WRITE_FAILED',
        message: 'The file could not be recorded, so it was not saved. Please try again.',
      });
    }
    return this.toItem(uploaded, connection, folder) as OneDriveItem;
  }

  async download(ctx: StorageRequestContext, rawPath: unknown): Promise<DownloadedFile> {
    const segments = parseRelativePath(rawPath, { allowRoot: false });
    const connection = await this.connections.requireUsable(ctx.workspaceId, ctx.user);
    const graph = this.graphContext(ctx);

    return withGraphErrors(async () => {
      const item = await this.getFile(graph, connection, segments);
      const response = await this.graph.requestRaw(
        graph,
        itemPath(connection.driveId, connection.rootItemId, segments, '/content'),
        {
          ...GRAPH,
          headers: { Accept: '*/*' },
        },
      );
      if (!response.body)
        throw new BadGatewayException({ code: 'ONEDRIVE_ERROR', message: 'OneDrive sent an empty response.' });
      return { stream: Readable.fromWeb(response.body as unknown as NodeWebStream), filename: item.name };
    });
  }

  async rename(ctx: StorageRequestContext, rawPath: unknown, newName: unknown): Promise<OneDriveItem> {
    const segments = parseRelativePath(rawPath, { allowRoot: false });
    if (typeof newName !== 'string')
      throw new BadRequestException({ code: 'INVALID_PATH', message: 'The new name must be text.' });
    assertAllowedFileName(newName);

    const connection = await this.connections.requireUsable(ctx.workspaceId, ctx.user);
    const graph = this.graphContext(ctx);
    const parent = segments.slice(0, -1);

    const { before, renamed } = await withGraphErrors(async () => {
      const current = await this.getFile(graph, connection, segments);
      const updated = await this.patchName(graph, connection, current.id, newName);
      this.assertInDrive(updated, connection);
      return { before: current, renamed: updated };
    });

    try {
      await this.recordFile(ctx, connection, renamed, [...parent, renamed.name], undefined);
    } catch (error) {
      this.logger.error({ event: 'onedrive_metadata_failed', operation: 'rename', error: describeError(error) });
      // Compensate: put the old name back so OneDrive and the metadata agree.
      await this.patchName(graph, connection, before.id, before.name).catch((revertError: unknown) =>
        this.logger.error({ event: 'onedrive_rename_revert_failed', error: describeError(revertError) }),
      );
      throw new ServiceUnavailableException({
        code: 'METADATA_WRITE_FAILED',
        message: 'The file could not be renamed. Please try again.',
      });
    }
    return this.toItem(renamed, connection, parent) as OneDriveItem;
  }

  async delete(ctx: StorageRequestContext, rawPath: unknown): Promise<void> {
    const segments = parseRelativePath(rawPath, { allowRoot: false });
    const connection = await this.connections.requireUsable(ctx.workspaceId, ctx.user);
    const graph = this.graphContext(ctx);

    const item = await withGraphErrors(() => this.getFile(graph, connection, segments));
    const userId = BigInt(ctx.user.id);

    // Metadata first: it is reversible. If this fails nothing has been deleted anywhere.
    const row = await this.findRow(connection, item.id);
    if (row) {
      try {
        await this.prisma.files.update({
          where: { id: row.id },
          data: {
            is_deleted: true,
            deleted_at: new Date(),
            deleted_by: userId,
            upload_status: 'deleted',
            updated_by: userId,
          },
        });
      } catch (error) {
        this.logger.error({ event: 'onedrive_metadata_failed', operation: 'delete', error: describeError(error) });
        throw new ServiceUnavailableException({
          code: 'METADATA_WRITE_FAILED',
          message: 'The file could not be deleted. Please try again.',
        });
      }
    }

    try {
      await withGraphErrors(() =>
        this.graph.request(
          graph,
          `/drives/${encodeURIComponent(connection.driveId)}/items/${encodeURIComponent(item.id)}`,
          { ...GRAPH, method: 'DELETE' },
        ),
      );
    } catch (error) {
      // Already gone from OneDrive is the outcome we wanted. Anything else: undo the soft-delete and report it.
      const alreadyGone = error instanceof NotFoundException;
      if (!alreadyGone) {
        if (row) await this.undoSoftDelete(row.id, userId);
        throw error;
      }
    }
  }

  // ----- helpers ---------------------------------------------------------------------------------------------------

  private graphContext(ctx: StorageRequestContext): GraphRequestContext {
    if (!ctx.session.homeAccountId) {
      throw new UnauthorizedException({
        code: 'MICROSOFT_REAUTH_REQUIRED',
        message: 'Your Microsoft session has to be renewed. Please sign in again.',
      });
    }
    return { cache: sessionTokenCache(ctx.session), homeAccountId: ctx.session.homeAccountId };
  }

  /** The item at a path under the root (the root itself for an empty path), checked to be in the connection's drive. */
  private async getItem(
    graph: GraphRequestContext,
    connection: UsableConnection,
    segments: readonly string[],
  ): Promise<GraphDriveItem> {
    const item = await this.graph.request<GraphDriveItem>(
      graph,
      itemPath(connection.driveId, connection.rootItemId, segments),
      GRAPH,
    );
    if (!item?.id) throw new MicrosoftApiError('not_found');
    this.assertInDrive(item, connection);
    await this.assertInsideRoot(graph, connection, item);
    return item;
  }

  private async getFile(
    graph: GraphRequestContext,
    connection: UsableConnection,
    segments: readonly string[],
  ): Promise<GraphDriveItem> {
    const item = await this.getItem(graph, connection, segments);
    if (!item.file)
      throw new BadRequestException({ code: 'NOT_A_FILE', message: 'That item is a folder, not a file.' });
    return item;
  }

  /**
   * Defence in depth. The browser never sends item ids and every path is resolved UNDER the stored root item, so a path
   * cannot leave FileForge. This also proves it from Graph's own ancestry: the item must sit inside the FileForge root
   * (this refuses, among others, anything in `FileForge-Central`, which holds other users' files). When Graph gives no
   * path, the parent chain is walked up to the root instead; an item is never assumed to be inside.
   */
  private async assertInsideRoot(
    graph: GraphRequestContext,
    connection: UsableConnection,
    item: GraphDriveItem,
  ): Promise<void> {
    if (item.id === connection.rootItemId) return;
    const verdict = ancestryUnder(item.parentReference?.path, ROOT_FOLDER_NAME);
    if (verdict === 'inside') return;
    if (verdict === 'unknown' && (await this.walksUpToRoot(graph, connection, item.parentReference?.id))) return;
    throw new ForbiddenException({
      code: 'ITEM_OUTSIDE_STORAGE_ROOT',
      message: 'That item is outside the FileForge folder.',
    });
  }

  /** True only if following the parent ids (bounded) reaches the stored root item without leaving the drive. */
  private async walksUpToRoot(
    graph: GraphRequestContext,
    connection: UsableConnection,
    startId: string | undefined,
  ): Promise<boolean> {
    let id = startId;
    for (let depth = 0; depth < MAX_ANCESTRY_DEPTH && id; depth++) {
      if (id === connection.rootItemId) return true;
      const parent = await this.graph.request<GraphDriveItem>(
        graph,
        `/drives/${encodeURIComponent(connection.driveId)}/items/${encodeURIComponent(id)}?$select=id,parentReference`,
        GRAPH,
      );
      if (!parent?.id || parent.parentReference?.driveId !== connection.driveId) return false;
      id = parent.parentReference?.id;
    }
    return false;
  }

  /** Fail closed: a shortcut to another drive, an item whose drive is not the connection's, or one Graph places outside the FileForge root is never acted on. */
  private assertInDrive(item: GraphDriveItem, connection: UsableConnection): void {
    const outsideRoot =
      item.id !== connection.rootItemId && ancestryUnder(item.parentReference?.path, ROOT_FOLDER_NAME) === 'outside';
    if (item.remoteItem || item.parentReference?.driveId !== connection.driveId || outsideRoot) {
      throw new ForbiddenException({
        code: 'ITEM_OUTSIDE_STORAGE_ROOT',
        message: 'That item is outside the FileForge folder.',
      });
    }
  }

  private patchName(
    graph: GraphRequestContext,
    connection: UsableConnection,
    itemId: string,
    name: string,
  ): Promise<GraphDriveItem> {
    return this.graph
      .request<GraphDriveItem>(
        graph,
        `/drives/${encodeURIComponent(connection.driveId)}/items/${encodeURIComponent(itemId)}`,
        {
          ...GRAPH,
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ name, '@microsoft.graph.conflictBehavior': 'fail' }),
        },
      )
      .then((item) => {
        if (!item) throw new MicrosoftApiError('unknown');
        return item;
      });
  }

  private toItem(item: GraphDriveItem, connection: UsableConnection, parent: readonly string[]): OneDriveItem | null {
    // Shortcuts, notebooks, anything not a plain file/folder, and anything from another drive are not listed.
    if (item.remoteItem || item.package || (!item.file && !item.folder)) return null;
    if (item.parentReference?.driveId && item.parentReference.driveId !== connection.driveId) return null;
    if (ancestryUnder(item.parentReference?.path, ROOT_FOLDER_NAME) === 'outside') return null;
    return {
      name: item.name,
      type: item.folder ? 'folder' : 'file',
      size: item.size ?? 0,
      mimeType: item.file?.mimeType ?? null,
      modifiedAt: item.lastModifiedDateTime ?? null,
      path: joinPath([...parent, item.name]),
    };
  }

  private findRow(connection: UsableConnection, externalObjectId: string) {
    return this.prisma.files.findFirst({
      where: {
        workspace_id: connection.workspaceId,
        connection_id: connection.id,
        external_object_id: externalObjectId,
        is_deleted: false,
      },
    });
  }

  /** Creates or updates the storage.files row for an item (matched by connection + OneDrive item id). */
  private async recordFile(
    ctx: StorageRequestContext,
    connection: UsableConnection,
    item: GraphDriveItem,
    pathSegments: readonly string[],
    sha256: string | undefined,
  ): Promise<void> {
    const userId = BigInt(ctx.user.id);
    const data = {
      filename: item.name,
      mime_type: (item.file?.mimeType ?? 'application/octet-stream').slice(0, 255),
      size_bytes: BigInt(item.size ?? 0),
      storage_path: joinPath(pathSegments),
      external_parent_id: item.parentReference?.id ?? null,
      external_drive_id: connection.driveId,
      external_web_url: item.webUrl ?? null,
      external_etag: item.eTag ?? null,
      external_ctag: item.cTag ?? null,
      external_created_at: item.createdDateTime ? new Date(item.createdDateTime) : null,
      external_last_modified_at: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null,
      upload_status: 'ready',
      updated_by: userId,
      ...(sha256 ? { checksum_sha256: sha256 } : {}),
    };

    const existing = await this.findRow(connection, item.id);
    if (existing) {
      await this.prisma.files.update({ where: { id: existing.id }, data });
      return;
    }
    try {
      await this.prisma.files.create({
        data: {
          ...data,
          workspace_id: connection.workspaceId,
          connection_id: connection.id,
          external_object_id: item.id,
          uploaded_by: userId,
          created_by: userId,
        },
      });
    } catch (error) {
      // Lost a race with a concurrent request for the same item: update that row instead of failing.
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002') {
        const raced = await this.findRow(connection, item.id);
        if (raced) {
          await this.prisma.files.update({ where: { id: raced.id }, data });
          return;
        }
      }
      throw error;
    }
  }

  private async undoSoftDelete(id: bigint, userId: bigint): Promise<void> {
    try {
      await this.prisma.files.update({
        where: { id },
        data: { is_deleted: false, deleted_at: null, deleted_by: null, upload_status: 'ready', updated_by: userId },
      });
    } catch (error) {
      this.logger.error({ event: 'onedrive_soft_delete_undo_failed', error: describeError(error) });
    }
  }

  private async removeQuietly(
    graph: GraphRequestContext,
    connection: UsableConnection,
    itemId: string,
    operation: string,
  ): Promise<void> {
    try {
      await this.graph.request(
        graph,
        `/drives/${encodeURIComponent(connection.driveId)}/items/${encodeURIComponent(itemId)}`,
        { ...GRAPH, method: 'DELETE' },
      );
    } catch (error) {
      this.logger.error({ event: 'onedrive_compensation_failed', operation, error: describeError(error) });
    }
  }
}
