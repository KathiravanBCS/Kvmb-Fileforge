import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Request, Response } from 'express';
import { diskStorage } from 'multer';
import type { z } from 'zod';

import { BadRequestException, StreamableFile } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

import { assertAllowedFileName, attachmentDisposition } from '../storage/onedrive/onedrive-paths';
import type { RequestMeta } from './central-storage-access.service';
import { CENTRAL_MAX_FILE_BYTES } from './central-storage.constants';
import type { DownloadedCentralFile } from './central-storage.service';
import type { IncomingFile } from './types/central-storage.types';

/** Uploads are written here first (never held in memory), then streamed to OneDrive, then deleted. */
export const UPLOAD_TMP_DIR = join(tmpdir(), 'fileforge-central-uploads');

/**
 * Multipart handling for uploads. Disk storage with a hard size cap: an oversized upload is rejected (413) while it is
 * being received. The temporary file gets a random name; the browser's file name is only ever a display name. A blocked
 * file type is refused before a single byte is written. `defParamCharset` reads non-ASCII names as UTF-8.
 */
export const UPLOAD_OPTIONS: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, done) => done(null, UPLOAD_TMP_DIR),
    filename: (_req, _file, done) => done(null, randomUUID()),
  }),
  limits: { fileSize: CENTRAL_MAX_FILE_BYTES, files: 1, fields: 2, fieldSize: 1024 },
  defParamCharset: 'utf8',
  fileFilter: (_req, file, done) => {
    try {
      assertAllowedFileName(file.originalname.normalize('NFC'));
      done(null, true);
    } catch (error) {
      done(error as Error, false);
    }
  },
};

export function toIncoming(file: Express.Multer.File | undefined): IncomingFile {
  if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Choose a file to upload.' });
  return { path: file.path, originalName: file.originalname, size: file.size };
}

/** For the audit trail: a server-generated request id and the client address (never headers, cookies or bodies). */
export function requestMeta(req: Request): RequestMeta {
  return { requestId: typeof req.id === 'string' ? req.id : undefined, ip: req.ip };
}

/** Aborts when the browser goes away before the response is finished (upload cancelled, tab closed). */
export function abortWhenClientLeaves(res: Response): AbortSignal {
  const controller = new AbortController();
  res.once('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

export function parseWith<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException({ code: 'INVALID_REQUEST', message: 'The request is not valid.' });
  return parsed.data;
}

/** Always a download, whatever the file claims to be: stored HTML/SVG must never run on this origin. */
export function sendDownload(res: Response, file: DownloadedCentralFile): StreamableFile {
  res.set({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': attachmentDisposition(file.filename),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  return new StreamableFile(file.stream);
}

/**
 * Inline view of a content type the service verified from the file's bytes (image, PDF, plain text). The CSP forbids
 * everything and `sandbox` blocks scripts and plugins, so even a hostile PDF or text file cannot act as a web page.
 */
export function sendPreview(res: Response, file: DownloadedCentralFile): StreamableFile {
  res.set({
    'Content-Type': file.mimeType === 'text/plain' ? 'text/plain; charset=utf-8' : file.mimeType,
    'Content-Disposition': attachmentDisposition(file.filename).replace(/^attachment/, 'inline'),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store',
  });
  return new StreamableFile(file.stream);
}
