import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { Readable } from 'node:stream';

import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';

import type { central_files, Prisma } from '../../../generated/prisma/client';
import { describeError } from '../../common/utils/logging.util';
import { PrismaService } from '../../prisma/prisma.service';
import { MicrosoftApiError } from '../microsoft/microsoft.errors';
import { assertAllowedFileName } from '../storage/onedrive/onedrive-paths';
import { extensionOf, inspectContent, PREVIEW_MIME_TYPES } from './central-file-content';
import { typeFilter } from './central-file-types';
import { CentralStorageAccessService } from './central-storage-access.service';
import { CentralStorageAuditService, type AuditDetails } from './central-storage-audit.service';
import { fileNotFound } from './central-storage-errors';
import { CentralStorageOneDriveService } from './central-storage-onedrive.service';
import {
  CENTRAL_MAX_FILE_BYTES,
  ENTITY_CENTRAL_FILE,
  FILE_STATUS,
  READABLE_STATUSES,
} from './central-storage.constants';
import type { ListQuery } from './dto/central-storage.dto';
import type {
  Actor,
  CentralFilePage,
  CentralFileView,
  CentralUsage,
  IncomingFile,
} from './types/central-storage.types';

const BIGINT_MAX = 9223372036854775807n;
/** A file stuck in `replacing` longer than this may be replaced again (the earlier attempt was interrupted). */
const STALE_REPLACE_MS = 10 * 60 * 1000;
/** A new operation starts with a clean recovery record: whatever the worker knew about an earlier attempt no longer applies. */
const RECOVERY_RESET = {
  recovery_attempts: 0,
  next_recovery_at: null,
  last_recovery_at: null,
  last_recovery_outcome: null,
  needs_review: false,
  review_reason: null,
} as const;
/** Rows that are visible, listable and downloadable. */
const LIVE = { is_deleted: false, upload_status: { in: READABLE_STATUSES } } as const;

/** A file id from a URL. Anything that is not a valid BIGINT is "not found", never an error that hints at the format. */
export function parseFileId(raw: string): bigint {
  if (typeof raw !== 'string' || !/^\d{1,19}$/.test(raw) || BigInt(raw) > BIGINT_MAX) throw fileNotFound();
  return BigInt(raw);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function codeOf(error: unknown): string {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (typeof body === 'object' && body !== null && typeof (body as { code?: unknown }).code === 'string') {
      return (body as { code: string }).code.slice(0, 60);
    }
  }
  return 'OPERATION_FAILED';
}

export interface DownloadedCentralFile {
  stream: Readable;
  filename: string;
  mimeType: string;
}

/**
 * Central storage files: one PostgreSQL row per file (who owns it, what it is, where it is in OneDrive) and the content
 * in the central OneDrive.
 *
 * AUTHORIZATION: every query that finds, changes or lists files includes `ownerScope(actor)`. For a normal user that is
 * `owner_user_id = <their id from the server session>`, so someone else's file is indistinguishable from a missing one
 * (404). Only an Actor created by CentralStorageAccessService.adminActor (after a database check) is unscoped.
 *
 * CONSISTENCY (OneDrive holds the bytes, PostgreSQL the truth about ownership):
 *  - upload:  row `uploading`, then OneDrive, then row `ready`. OneDrive fails -> row `failed`. Metadata fails -> the new
 *             OneDrive item is removed again and the row is `failed`. Nothing half-done stays visible.
 *  - replace: row `replacing` (still readable), then OneDrive, then `ready` + new size/checksum. OneDrive fails -> back to
 *             `ready` (old content intact). Metadata fails -> stays `replacing` with an error code; an administrator's
 *             "resync" re-reads OneDrive and repairs it (and a stale `replacing` can be replaced again after 10 minutes).
 *  - delete:  row `deleting` + soft-deleted FIRST (hidden), then OneDrive, then `deleted`. OneDrive fails -> the row is
 *             restored (visible again). If even that fails the row stays `deleting`; an administrator can retry the delete.
 *  - rename:  display name only (the OneDrive item keeps its generated name), so it can never be half-done.
 */
@Injectable()
export class CentralStorageService {
  private readonly logger = new Logger(CentralStorageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: CentralStorageOneDriveService,
    private readonly access: CentralStorageAccessService,
    private readonly audit: CentralStorageAuditService,
  ) {}

  // ----- reads -----------------------------------------------------------------------------------------------------

  async list(actor: Actor, query: ListQuery): Promise<CentralFilePage> {
    const where = this.listWhere(actor, query);
    const sortField = { name: 'display_name', size: 'size_bytes', type: 'file_extension', date: 'created_at' }[
      query.sort
    ];
    const orderBy = [{ [sortField]: query.order }, { id: 'asc' }] as Prisma.central_filesOrderByWithRelationInput[];

    const [rows, total] = await Promise.all([
      this.prisma.central_files.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.central_files.count({ where }),
    ]);
    return { items: await this.toViews(actor, rows), page: query.page, pageSize: query.pageSize, total };
  }

  async get(actor: Actor, rawId: string): Promise<CentralFileView> {
    const row = await this.findReadable(actor, rawId);
    return (await this.toViews(actor, [row]))[0];
  }

  async usage(actor: Actor): Promise<CentralUsage> {
    const total = await this.prisma.central_files.aggregate({
      where: { ...LIVE, ...this.ownerScope(actor) },
      _sum: { size_bytes: true },
      _count: { _all: true },
    });
    return { fileCount: total._count._all, totalBytes: Number(total._sum.size_bytes ?? 0n) };
  }

  /** Administrators only: usage of every user that has files. */
  async usageByUser(actor: Actor): Promise<{ ownerId: bigint; fileCount: number; totalBytes: number }[]> {
    if (!actor.isAdmin) throw fileNotFound();
    const groups = await this.prisma.central_files.groupBy({
      by: ['owner_user_id'],
      where: { ...LIVE },
      _sum: { size_bytes: true },
      _count: { _all: true },
    });
    return groups.map((group) => ({
      ownerId: group.owner_user_id,
      fileCount: group._count._all,
      totalBytes: Number(group._sum.size_bytes ?? 0n),
    }));
  }

  async download(actor: Actor, rawId: string): Promise<DownloadedCentralFile> {
    const row = await this.findReadable(actor, rawId);
    await this.auditCrossUser(actor, 'central_storage.file.download', row);
    const stream = await this.storage.download(this.itemIdOf(row));
    return { stream, filename: row.display_name, mimeType: row.mime_type };
  }

  /** Inline viewing: only for content types the BYTES proved (see central-file-content.ts). Anything else is download-only. */
  async preview(actor: Actor, rawId: string): Promise<DownloadedCentralFile> {
    const row = await this.findReadable(actor, rawId);
    if (!PREVIEW_MIME_TYPES.has(row.mime_type)) {
      throw new HttpException(
        { code: 'PREVIEW_NOT_SUPPORTED', message: 'This file type cannot be previewed. Download it instead.' },
        415,
      );
    }
    await this.auditCrossUser(actor, 'central_storage.file.preview', row);
    const stream = await this.storage.download(this.itemIdOf(row));
    return { stream, filename: row.display_name, mimeType: row.mime_type };
  }

  // ----- writes ----------------------------------------------------------------------------------------------------

  /**
   * Stores a new file for `targetOwnerId` (default: the actor). Only an administrator may name another owner; a normal
   * user asking for someone else's folder gets "not found". Always removes the temporary upload file.
   */
  async upload(
    actor: Actor,
    targetOwnerId: bigint | null,
    file: IncomingFile,
    signal?: AbortSignal,
  ): Promise<CentralFileView> {
    try {
      const ownerId = targetOwnerId ?? actor.userId;
      const forOther = ownerId !== actor.userId;
      if (forOther && !actor.isAdmin) throw fileNotFound();
      await this.assertStillAdmin(actor);
      if (forOther) await this.access.requireEligibleOwner(ownerId);

      const displayName = file.originalName.normalize('NFC');
      assertAllowedFileName(displayName);
      this.assertSize(file.size);
      const mimeType = await inspectContent(file.path, displayName);
      const extension = extensionOf(displayName);
      if (forOther) {
        await this.audit.record(
          actor,
          'central_storage.file.upload_for_user',
          { type: ENTITY_CENTRAL_FILE },
          {
            ownerUserId: ownerId.toString(),
            size: file.size,
            extension,
          },
        );
      }

      const connection = await this.storage.usableConnection();
      const checksum = await sha256File(file.path);
      const storedName = `${randomUUID()}${extension ? `.${extension}` : ''}`;
      const row = await this.prisma.central_files.create({
        data: {
          connection_id: connection.id,
          owner_user_id: ownerId,
          uploaded_by: actor.userId,
          display_name: displayName,
          stored_name: storedName,
          file_extension: extension,
          mime_type: mimeType,
          size_bytes: BigInt(file.size),
          checksum_sha256: checksum,
          external_drive_id: connection.driveId,
          upload_status: FILE_STATUS.uploading,
          created_by: actor.userId,
        },
      });

      let item;
      try {
        item = await this.storage.uploadNew(ownerId, storedName, file, signal);
      } catch (error) {
        await this.markFailed(row.id, actor, error);
        throw error;
      }

      let ready: central_files;
      try {
        // Conditional: if recovery already settled this row (a request that ran far longer than it should), do not overwrite it.
        const finished = await this.prisma.central_files.updateMany({
          where: { id: row.id, upload_status: FILE_STATUS.uploading },
          data: {
            upload_status: FILE_STATUS.ready,
            uploaded_at: new Date(),
            external_item_id: item.id,
            external_etag: item.eTag ?? null,
            external_ctag: item.cTag ?? null,
            external_created_at: item.createdDateTime ? new Date(item.createdDateTime) : null,
            external_last_modified_at: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null,
            size_bytes: BigInt(item.size ?? file.size),
            updated_by: actor.userId,
          },
        });
        const current = await this.prisma.central_files.findFirst({ where: { id: row.id } });
        // Recovery may have recorded this very item already: that is success, and the item must NOT be removed.
        if (
          !current ||
          (finished.count !== 1 &&
            !(current.upload_status === FILE_STATUS.ready && current.external_item_id === item.id))
        ) {
          throw new Error('The upload record was changed by someone else.');
        }
        ready = current;
      } catch (error) {
        this.logger.error({ event: 'central_metadata_failed', operation: 'upload', error: describeError(error) });
        // The item exists only because of this request: remove it again so OneDrive and PostgreSQL agree.
        await this.storage.deleteItem(item.id).catch((cleanupError: unknown) =>
          this.logger.error({
            event: 'central_cleanup_failed',
            operation: 'upload',
            error: describeError(cleanupError),
          }),
        );
        await this.markFailed(row.id, actor, new HttpException({ code: 'METADATA_WRITE_FAILED' }, 503));
        throw metadataFailed('The file could not be recorded, so it was not saved. Please try again.');
      }
      return (await this.toViews(actor, [ready]))[0];
    } finally {
      await rm(file.path, { force: true });
    }
  }

  /** Replaces the CONTENT of an existing file (same name, same owner). The content must match the file's own type. */
  async replace(actor: Actor, rawId: string, file: IncomingFile, signal?: AbortSignal): Promise<CentralFileView> {
    try {
      await this.assertStillAdmin(actor);
      const row = await this.findReadable(actor, rawId);
      const itemId = this.itemIdOf(row);
      this.assertSize(file.size);
      const mimeType = await inspectContent(file.path, row.display_name);
      await this.auditCrossUser(actor, 'central_storage.file.replace', row, { size: file.size });
      const checksum = await sha256File(file.path);

      // Claim it: one replacement at a time. A `replacing` row older than 10 minutes was interrupted and may be retaken.
      const claimed = await this.prisma.central_files.updateMany({
        where: {
          id: row.id,
          ...this.ownerScope(actor),
          is_deleted: false,
          OR: [
            { upload_status: FILE_STATUS.ready },
            {
              upload_status: FILE_STATUS.replacing,
              updated_at: { lt: new Date(Date.now() - STALE_REPLACE_MS) },
              // Not while the recovery worker is working on it.
              recovery_lease_token: null,
            },
          ],
        },
        data: {
          upload_status: FILE_STATUS.replacing,
          last_error_code: null,
          updated_by: actor.userId,
          // What this replacement WILL leave in OneDrive: lets recovery tell "it landed" from "it did not" after an interruption.
          pending_size_bytes: BigInt(file.size),
          pending_checksum_sha256: checksum,
          ...RECOVERY_RESET,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: 'FILE_BUSY',
          message: 'This file is being changed. Try again in a moment.',
        });
      }

      let item;
      try {
        item = await this.storage.replaceContent(itemId, file, signal);
      } catch (error) {
        // The old content is still intact in OneDrive (a replace only takes effect when its last chunk lands).
        await this.prisma.central_files
          .updateMany({
            where: { id: row.id, upload_status: FILE_STATUS.replacing },
            data: {
              upload_status: FILE_STATUS.ready,
              last_error_code: codeOf(error),
              updated_by: actor.userId,
              pending_size_bytes: null,
              pending_checksum_sha256: null,
            },
          })
          .catch((restoreError: unknown) =>
            this.logger.error({ event: 'central_replace_restore_failed', error: describeError(restoreError) }),
          );
        throw error;
      }

      try {
        const finished = await this.prisma.central_files.updateMany({
          where: { id: row.id, upload_status: FILE_STATUS.replacing },
          data: {
            upload_status: FILE_STATUS.ready,
            mime_type: mimeType,
            size_bytes: BigInt(item.size ?? file.size),
            checksum_sha256: checksum,
            content_version: { increment: 1 },
            external_etag: item.eTag ?? null,
            external_ctag: item.cTag ?? null,
            external_last_modified_at: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null,
            uploaded_at: new Date(),
            last_error_code: null,
            updated_by: actor.userId,
            pending_size_bytes: null,
            pending_checksum_sha256: null,
            ...RECOVERY_RESET,
          },
        });
        const updated = await this.prisma.central_files.findFirst({ where: { id: row.id } });
        // Recovery may already have recorded exactly this replacement: that is success.
        if (
          !updated ||
          (finished.count !== 1 &&
            !(updated.upload_status === FILE_STATUS.ready && updated.external_etag === (item.eTag ?? null)))
        ) {
          throw new Error('The file record was changed by someone else.');
        }
        return (await this.toViews(actor, [updated]))[0];
      } catch (error) {
        this.logger.error({ event: 'central_metadata_failed', operation: 'replace', error: describeError(error) });
        // OneDrive already has the new content. Leave the row `replacing` (still readable) and say so; "resync" repairs it.
        await this.prisma.central_files
          .updateMany({ where: { id: row.id }, data: { last_error_code: 'METADATA_WRITE_FAILED' } })
          .catch(() => undefined);
        throw metadataFailed(
          'The new content was stored but could not be recorded. An administrator can resync this file.',
        );
      }
    } finally {
      await rm(file.path, { force: true });
    }
  }

  /** Display name only. The extension must stay the same, so the stored content type never disagrees with the name. */
  async rename(actor: Actor, rawId: string, newName: string): Promise<CentralFileView> {
    await this.assertStillAdmin(actor);
    const row = await this.findReadable(actor, rawId);
    const name = newName.normalize('NFC');
    assertAllowedFileName(name);
    if (extensionOf(name) !== extensionOf(row.display_name)) {
      throw new BadRequestException({
        code: 'EXTENSION_CHANGE_NOT_ALLOWED',
        message: 'The file extension cannot be changed. Keep the same extension.',
      });
    }
    await this.auditCrossUser(actor, 'central_storage.file.rename', row);

    const updated = await this.prisma.central_files.updateMany({
      where: { id: row.id, ...this.ownerScope(actor), ...LIVE },
      data: { display_name: name, updated_by: actor.userId },
    });
    if (updated.count !== 1) throw fileNotFound();
    return this.get(actor, rawId);
  }

  async remove(actor: Actor, rawId: string): Promise<void> {
    await this.assertStillAdmin(actor);
    const id = parseFileId(rawId);
    const row = await this.prisma.central_files.findFirst({
      where: {
        id,
        ...this.ownerScope(actor),
        // An administrator may also retry a delete that was interrupted half way.
        OR: [{ ...LIVE }, ...(actor.isAdmin ? [{ upload_status: FILE_STATUS.deleting }] : [])],
      },
    });
    if (!row) throw fileNotFound();
    await this.auditCrossUser(actor, 'central_storage.file.delete', row);

    // Hide the file FIRST (reversible). Nothing has been deleted anywhere yet if this fails.
    const alreadyDeleting = row.upload_status === FILE_STATUS.deleting;
    if (!alreadyDeleting) {
      const claimed = await this.prisma.central_files.updateMany({
        where: { id: row.id, ...this.ownerScope(actor), ...LIVE },
        data: {
          upload_status: FILE_STATUS.deleting,
          is_deleted: true,
          deleted_at: new Date(),
          deleted_by: actor.userId,
          updated_by: actor.userId,
        },
      });
      if (claimed.count !== 1) throw fileNotFound();
    }

    try {
      if (row.external_item_id) await this.storage.deleteItem(row.external_item_id);
    } catch (error) {
      // OneDrive still has the file: make it visible again so it is not lost to everyone.
      if (!alreadyDeleting) {
        await this.prisma.central_files
          .updateMany({
            where: { id: row.id, upload_status: FILE_STATUS.deleting },
            data: {
              upload_status: row.upload_status,
              is_deleted: false,
              deleted_at: null,
              deleted_by: null,
              updated_by: actor.userId,
            },
          })
          .catch((restoreError: unknown) =>
            this.logger.error({ event: 'central_delete_restore_failed', error: describeError(restoreError) }),
          );
      }
      throw error;
    }
    await this.prisma.central_files
      .updateMany({ where: { id: row.id }, data: { upload_status: FILE_STATUS.deleted, updated_by: actor.userId } })
      .catch((finalizeError: unknown) =>
        this.logger.error({ event: 'central_delete_finalize_failed', error: describeError(finalizeError) }),
      );
  }

  /** Administrators only. Re-reads the file from OneDrive and repairs the row (size, version info, status). */
  async resync(actor: Actor, rawId: string): Promise<CentralFileView> {
    if (!actor.isAdmin) throw fileNotFound();
    await this.assertStillAdmin(actor);
    const id = parseFileId(rawId);
    const row = await this.prisma.central_files.findFirst({ where: { id, is_deleted: false } });
    if (!row || !row.external_item_id) throw fileNotFound();
    await this.auditCrossUser(actor, 'central_storage.file.resync', row);

    const item = await this.storage.getItem(row.external_item_id);
    const updated = await this.prisma.central_files.update({
      where: { id: row.id },
      data: {
        upload_status: FILE_STATUS.ready,
        size_bytes: BigInt(item.size ?? Number(row.size_bytes)),
        external_etag: item.eTag ?? null,
        external_ctag: item.cTag ?? null,
        external_last_modified_at: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null,
        last_error_code: null,
        updated_by: actor.userId,
      },
    });
    return (await this.toViews(actor, [updated]))[0];
  }

  // ----- internals -------------------------------------------------------------------------------------------------

  /** THE ownership rule. Users: only their own rows. Administrators (actor from adminActor): every row. */
  private ownerScope(actor: Actor): Prisma.central_filesWhereInput {
    return actor.isAdmin ? {} : { owner_user_id: actor.userId };
  }

  private listWhere(actor: Actor, query: ListQuery): Prisma.central_filesWhereInput {
    const and: Prisma.central_filesWhereInput[] = [];
    if (query.search) and.push({ display_name: { contains: query.search, mode: 'insensitive' } });
    if (query.type) and.push(typeFilter(query.type));
    const ownerFilter: Prisma.central_filesWhereInput =
      actor.isAdmin && query.ownerUserId ? { owner_user_id: BigInt(query.ownerUserId) } : {};
    return { ...LIVE, ...this.ownerScope(actor), ...ownerFilter, ...(and.length > 0 ? { AND: and } : {}) };
  }

  private async findReadable(actor: Actor, rawId: string): Promise<central_files> {
    const id = parseFileId(rawId);
    const row = await this.prisma.central_files.findFirst({ where: { id, ...LIVE, ...this.ownerScope(actor) } });
    if (!row) throw fileNotFound();
    return row;
  }

  private itemIdOf(row: central_files): string {
    if (!row.external_item_id) throw fileNotFound();
    return row.external_item_id;
  }

  private assertSize(size: number): void {
    if (size <= 0) throw new BadRequestException({ code: 'EMPTY_FILE', message: 'The file is empty.' });
    if (size > CENTRAL_MAX_FILE_BYTES) {
      throw new PayloadTooLargeException({
        code: 'FILE_TOO_LARGE',
        message: `Files up to ${CENTRAL_MAX_FILE_BYTES / (1024 * 1024)} MB can be uploaded.`,
      });
    }
  }

  /** Administrator privilege is rechecked against the database for every administrator write. */
  private async assertStillAdmin(actor: Actor): Promise<void> {
    if (actor.isAdmin) await this.access.requireSystemAdmin(actor.userId);
  }

  /** An administrator touching someone ELSE's file is recorded first; if it cannot be recorded, it does not happen. */
  private async auditCrossUser(
    actor: Actor,
    action: string,
    row: central_files,
    extra: AuditDetails = {},
  ): Promise<void> {
    if (!actor.isAdmin || row.owner_user_id === actor.userId) return;
    await this.audit.record(
      actor,
      action,
      { type: ENTITY_CENTRAL_FILE, id: row.id },
      {
        ownerUserId: row.owner_user_id.toString(),
        ...extra,
      },
    );
  }

  private async markFailed(id: bigint, actor: Actor, error: unknown): Promise<void> {
    try {
      await this.prisma.central_files.update({
        where: { id },
        data: {
          upload_status: FILE_STATUS.failed,
          is_deleted: true,
          deleted_at: new Date(),
          deleted_by: actor.userId,
          last_error_code: error instanceof MicrosoftApiError ? error.kind : codeOf(error),
        },
      });
    } catch (updateError) {
      this.logger.error({ event: 'central_mark_failed_failed', error: describeError(updateError) });
    }
  }

  private async toViews(actor: Actor, rows: central_files[]): Promise<CentralFileView[]> {
    let owners = new Map<bigint, { id: string; displayName: string | null; email: string }>();
    if (actor.isAdmin && rows.length > 0) {
      const users = await this.prisma.users.findMany({
        where: { id: { in: [...new Set(rows.map((row) => row.owner_user_id))] } },
        select: { id: true, email: true, display_name: true },
      });
      owners = new Map(
        users.map((user) => [user.id, { id: user.id.toString(), displayName: user.display_name, email: user.email }]),
      );
    }
    return rows.map((row) => {
      const owner = owners.get(row.owner_user_id);
      return {
        id: row.id.toString(),
        name: row.display_name,
        extension: row.file_extension,
        mimeType: row.mime_type,
        size: Number(row.size_bytes),
        status: row.upload_status,
        contentVersion: row.content_version,
        previewable: PREVIEW_MIME_TYPES.has(row.mime_type),
        ownerId: row.owner_user_id.toString(),
        uploadedById: row.uploaded_by.toString(),
        createdAt: row.created_at.toISOString(),
        uploadedAt: row.uploaded_at?.toISOString() ?? null,
        updatedAt: row.updated_at?.toISOString() ?? null,
        ...(owner ? { owner } : {}),
      };
    });
  }
}

function metadataFailed(message: string): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: 'METADATA_WRITE_FAILED', message });
}
