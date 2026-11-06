import {
  IconFile,
  IconFileTypeCsv,
  IconFileTypeDoc,
  IconFileTypePdf,
  IconFileTypePpt,
  IconFileTypeTxt,
  IconFileTypeXls,
  IconFileZip,
  IconPhoto,
  type Icon,
} from '@tabler/icons-react';

// The personal File Manager already has the file-name rules and byte formatter. They are the same rules the API applies to
// central storage (it reuses that module's validation), so they are shared instead of copied.
import { formatBytes, validateFileName } from '@/features/file-manager/utils';
import { ApiError } from '@/lib/api-types';
import type { CentralFile, CentralFileType } from './types';

export { formatBytes };

/** `report.PDF` -> `pdf`; null when there is no usable extension. */
export function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,16}$/.test(extension) ? extension : null;
}

/**
 * A message if `file` cannot be uploaded, otherwise null. Early feedback only: the API applies the same limits and is the
 * one that enforces them (and also checks the file's real content type).
 */
export function validateCentralUpload(file: File, maxBytes: number): string | null {
  if (file.size === 0) return 'The file is empty.';
  if (file.size > maxBytes) return `Too large: files up to ${formatBytes(maxBytes)} can be uploaded.`;
  return validateFileName(file.name);
}

/** A message if `newName` is not a valid new name for `current`, otherwise null. The extension must stay the same. */
export function validateRename(newName: string, current: string): string | null {
  const invalid = validateFileName(newName);
  if (invalid) return invalid;
  if (extensionOf(newName) !== extensionOf(current)) return 'The file extension cannot be changed. Keep the same extension.';
  return null;
}

/** The choices of the file-type filter (the API's `type` values). */
export const TYPE_OPTIONS: { value: CentralFileType; label: string }[] = [
  { value: 'image', label: 'Images' },
  { value: 'pdf', label: 'PDF' },
  { value: 'document', label: 'Documents' },
  { value: 'spreadsheet', label: 'Spreadsheets' },
  { value: 'presentation', label: 'Presentations' },
  { value: 'text', label: 'Text' },
  { value: 'archive', label: 'Archives' },
  { value: 'other', label: 'Other' },
];

export interface FileKind {
  icon: Icon;
  color: string;
  label: string;
}

const KINDS: Record<string, FileKind> = {
  pdf: { icon: IconFileTypePdf, color: 'red', label: 'PDF' },
  doc: { icon: IconFileTypeDoc, color: 'blue', label: 'Word' },
  docx: { icon: IconFileTypeDoc, color: 'blue', label: 'Word' },
  xls: { icon: IconFileTypeXls, color: 'green', label: 'Excel' },
  xlsx: { icon: IconFileTypeXls, color: 'green', label: 'Excel' },
  csv: { icon: IconFileTypeCsv, color: 'green', label: 'CSV' },
  ppt: { icon: IconFileTypePpt, color: 'orange', label: 'PowerPoint' },
  pptx: { icon: IconFileTypePpt, color: 'orange', label: 'PowerPoint' },
  txt: { icon: IconFileTypeTxt, color: 'gray', label: 'Text' },
  zip: { icon: IconFileZip, color: 'yellow', label: 'Archive' },
};
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff', 'heic']);

/** How a file is shown in lists: icon, colour and a short type label, from its extension. */
export function fileKind(extension: string | null): FileKind {
  if (extension && IMAGE_EXTENSIONS.has(extension)) return { icon: IconPhoto, color: 'teal', label: 'Image' };
  if (extension && KINDS[extension]) return KINDS[extension];
  return { icon: IconFile, color: 'gray', label: extension ? extension.toUpperCase() : 'File' };
}

export function ownerLabel(owner: CentralFile['owner']): string {
  return owner ? owner.displayName || owner.email : 'Unknown user';
}

/** "30 seconds", "1 second", "5 minutes". */
export function formatWait(seconds: number): string {
  if (seconds >= 120) return `${Math.ceil(seconds / 60)} minutes`;
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

/** The user's own allowance for this period is used up (10 uploads / 10 replacements per 10 minutes by default). Waiting is the only fix. */
export function isUploadLimitReached(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 429 && error.code === 'UPLOAD_RATE_LIMITED';
}

const BUSY_CODES = new Set(['UPLOAD_CAPACITY_BUSY', 'UPLOAD_TOO_MANY_ACTIVE', 'CENTRAL_STORAGE_THROTTLED']);

/** The server is momentarily full (too many uploads running, or OneDrive is throttling). The same request usually works soon. */
export function isStorageBusy(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 429 && error.code !== null && BUSY_CODES.has(error.code);
}

/** Always something a person can read, from an ApiError (the API's own message), an abort, or anything else. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isNetworkError) return 'Unable to reach the server. Check your connection and try again.';
    // The API's 429 messages already say how long to wait; a bare 429 gets the Retry-After time added.
    if (error.status === 429 && error.retryAfterSeconds && !/\d|try again/i.test(error.message)) {
      return `${error.message} Try again in ${formatWait(error.retryAfterSeconds)}.`;
    }
    return error.message;
  }
  return error instanceof Error && error.message ? error.message : 'Something went wrong. Please try again.';
}

/** True when a request was cancelled on purpose (the user pressed Cancel), which is not a failure. */
export function isCancelled(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && (error.name === 'CanceledError' || error.name === 'AbortError'));
}
