import { BadRequestException } from '@nestjs/common';

import { MAX_UPLOAD_BYTES } from './onedrive.constants';

/**
 * The browser never sends Graph item ids. It sends a path RELATIVE to the FileForge root (e.g. `invoices/2026/a.pdf`);
 * the drive and root ids come only from the stored connection. Everything here is about making such a path safe.
 */

const MAX_NAME_LENGTH = 255;
const MAX_PATH_LENGTH = 400;
const MAX_DEPTH = 10;

// OneDrive-forbidden characters, control characters, and bidirectional overrides (filename spoofing, e.g. "evil\u202Efdp.exe").
// eslint-disable-next-line no-control-regex -- rejecting control characters is the purpose of this pattern
const FORBIDDEN_CHARS = /["*:<>?/\\|\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;
const RESERVED_BASENAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** Extensions of programs/scripts that must not be stored through the app (the final extension decides). */
const BLOCKED_EXTENSIONS = new Set([
  'exe',
  'com',
  'bat',
  'cmd',
  'msi',
  'msp',
  'scr',
  'pif',
  'cpl',
  'dll',
  'sys',
  'lnk',
  'reg',
  'hta',
  'ps1',
  'psm1',
  'vbs',
  'vbe',
  'js',
  'jse',
  'wsf',
  'wsh',
  'jar',
  'sh',
  'apk',
]);

function invalidPath(message: string): BadRequestException {
  return new BadRequestException({ code: 'INVALID_PATH', message });
}

/** Throws `INVALID_PATH` unless `name` is a safe, OneDrive-legal single file or folder name. */
export function assertValidItemName(name: string): void {
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) throw invalidPath('A name must be 1 to 255 characters.');
  if (name === '.' || name === '..') throw invalidPath('"." and ".." are not allowed.');
  if (FORBIDDEN_CHARS.test(name)) throw invalidPath('The name contains a character that OneDrive does not allow.');
  if (name !== name.trim()) throw invalidPath('A name cannot start or end with a space.');
  if (name.endsWith('.')) throw invalidPath('A name cannot end with a period.');
  if (name.startsWith('~$')) throw invalidPath('Names starting with "~$" are reserved.');
  if (name.includes('_vti_') || name.toLowerCase() === '.lock' || name.toLowerCase() === 'desktop.ini') {
    throw invalidPath('That name is reserved by OneDrive.');
  }
  if (RESERVED_BASENAMES.test(name.split('.')[0] ?? ''))
    throw invalidPath('That name is reserved by Windows/OneDrive.');
}

/**
 * Parses a relative path into validated segments. The empty string is the FileForge root.
 * Rejects absolute paths, empty segments, `.`/`..`, backslashes and anything OneDrive forbids.
 */
export function parseRelativePath(raw: unknown, options: { allowRoot: boolean }): string[] {
  if (raw === undefined || raw === null || raw === '') {
    if (options.allowRoot) return [];
    throw invalidPath('A path is required.');
  }
  if (typeof raw !== 'string') throw invalidPath('The path must be a single text value.');

  const path = raw.normalize('NFC');
  if (path.length > MAX_PATH_LENGTH) throw invalidPath('The path is too long.');
  if (path.startsWith('/') || path.endsWith('/'))
    throw invalidPath('The path must be relative, with no leading or trailing "/".');

  const segments = path.split('/');
  if (segments.length > MAX_DEPTH) throw invalidPath('The path is nested too deeply.');
  segments.forEach(assertValidItemName);
  return segments;
}

export function joinPath(segments: readonly string[]): string {
  return segments.join('/');
}

/** Extension rules for new files and for the target of a rename. */
export function assertAllowedFileName(name: string): void {
  assertValidItemName(name);
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (BLOCKED_EXTENSIONS.has(extension)) {
    throw new BadRequestException({
      code: 'FILE_TYPE_NOT_ALLOWED',
      message: `Files of type ".${extension}" cannot be stored here.`,
    });
  }
}

export function assertUploadSize(size: number): void {
  if (size <= 0) throw new BadRequestException({ code: 'EMPTY_FILE', message: 'The file is empty.' });
  if (size > MAX_UPLOAD_BYTES) {
    throw new BadRequestException({
      code: 'FILE_TOO_LARGE',
      message: `Files up to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB can be uploaded.`,
    });
  }
}

/**
 * Graph URL (relative to the Graph base) of an item addressed by path under the stored root item.
 * `suffix` is e.g. `/children` or `/content`. drive and root ids come from the database, never from the browser.
 */
export function itemPath(driveId: string, rootItemId: string, segments: readonly string[], suffix = ''): string {
  const base = `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(rootItemId)}`;
  if (segments.length === 0) return `${base}${suffix}`;
  const encoded = segments.map(encodeURIComponent).join('/');
  return suffix ? `${base}:/${encoded}:${suffix}` : `${base}:/${encoded}`;
}

/** `Content-Disposition: attachment` with an ASCII fallback and an RFC 5987 UTF-8 name. Never `inline`. */
export function attachmentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
