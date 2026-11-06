import { open } from 'node:fs/promises';

import { BadRequestException } from '@nestjs/common';

/**
 * Content types that may ever be shown inline. A file only gets one of these stored as its MIME type when its BYTES
 * confirmed it (magic numbers, or valid UTF-8 for text), never because the browser or the file name said so.
 * Everything else is download-only. SVG and HTML are deliberately absent: they can run script.
 */
export const PREVIEW_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
]);

const OCTET_STREAM = 'application/octet-stream';

/** Informational types for common documents (icons, filters). Never trusted for rendering: they are not previewable. */
const EXTENSION_MIME: Readonly<Record<string, string>> = {
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  zip: 'application/zip',
  json: 'application/json',
};

/** Extensions whose content type is checkable by magic number: a mismatch is rejected. */
const SNIFFABLE_EXTENSION: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const HEAD_BYTES = 64 * 1024;

/** The lowercase final extension (`a.tar.GZ` -> `gz`), or null. */
export function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,16}$/.test(extension) ? extension : null;
}

function startsWith(head: Buffer, bytes: number[], offset = 0): boolean {
  return bytes.every((byte, index) => head[offset + index] === byte);
}

/** The type the first bytes prove, or null. */
export function sniffMime(head: Buffer): string | null {
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, [0x47, 0x49, 0x46, 0x38]) && (head[4] === 0x37 || head[4] === 0x39) && head[5] === 0x61) {
    return 'image/gif'; // GIF87a / GIF89a
  }
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

function isPlainText(head: Buffer): boolean {
  if (head.includes(0)) return false;
  try {
    // `stream: true` tolerates a multi-byte character that is cut off at the end of the sample.
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Decides the stored MIME type of an uploaded file from its content. The MIME type the browser sent is never used.
 * Throws 400 when an extension that promises a checkable type (pdf, png, jpg, gif, webp) does not match its bytes.
 */
export async function inspectContent(filePath: string, displayName: string): Promise<string> {
  const handle = await open(filePath, 'r');
  let head: Buffer;
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    head = buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }

  const extension = extensionOf(displayName);
  const detected = sniffMime(head);
  const promised = extension ? SNIFFABLE_EXTENSION[extension] : undefined;

  if (promised && detected !== promised) {
    throw new BadRequestException({
      code: 'FILE_CONTENT_MISMATCH',
      message: `The file does not look like a real .${extension} file.`,
    });
  }
  if (detected) return detected;
  if (extension === 'txt') return isPlainText(head) ? 'text/plain' : OCTET_STREAM;
  return (extension && EXTENSION_MIME[extension]) || OCTET_STREAM;
}
