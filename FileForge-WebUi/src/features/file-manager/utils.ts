// Early feedback only. The server applies the same rules (and is the one that enforces them), so these
// mirror FileForge-Api/src/modules/storage/onedrive/{onedrive-paths.ts,onedrive.constants.ts}.

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const MAX_NAME_LENGTH = 255;
// OneDrive-forbidden characters, control characters and bidirectional overrides (filename spoofing).
// eslint-disable-next-line no-control-regex -- rejecting control characters is the purpose of this pattern
const FORBIDDEN_CHARS = /["*:<>?/\\|\u0000-\u001f\u007f‪-‮⁦-⁩]/;
const RESERVED_BASENAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'com', 'bat', 'cmd', 'msi', 'msp', 'scr', 'pif', 'cpl', 'dll', 'sys', 'lnk', 'reg', 'hta',
  'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'jar', 'sh', 'apk',
]);

/** A message if `name` cannot be a file name here, otherwise null. */
export function validateFileName(name: string): string | null {
  if (name.length === 0) return 'Enter a name.';
  if (name.length > MAX_NAME_LENGTH) return 'The name is too long (255 characters at most).';
  if (name === '.' || name === '..') return 'That name is not allowed.';
  if (FORBIDDEN_CHARS.test(name)) return 'The name contains a character that OneDrive does not allow.';
  if (name !== name.trim()) return 'The name cannot start or end with a space.';
  if (name.endsWith('.')) return 'The name cannot end with a period.';
  if (name.startsWith('~$')) return 'Names starting with "~$" are reserved.';
  if (name.includes('_vti_') || ['.lock', 'desktop.ini'].includes(name.toLowerCase())) return 'That name is reserved by OneDrive.';
  if (RESERVED_BASENAMES.test(name.split('.')[0] ?? '')) return 'That name is reserved by Windows.';

  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (BLOCKED_EXTENSIONS.has(extension)) return `Files of type ".${extension}" cannot be stored here.`;
  return null;
}

/** A message if `file` cannot be uploaded, otherwise null. */
export function validateUpload(file: File): string | null {
  if (file.size === 0) return 'The file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) return `Too large: files up to ${formatBytes(MAX_UPLOAD_BYTES)} can be uploaded.`;
  return validateFileName(file.name);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

/** `invoices/2026` -> ['invoices', '2026'] (the browser path is relative to the FileForge folder). */
export function pathSegments(path: string): string[] {
  return path === '' ? [] : path.split('/');
}

export function parentPath(path: string): string {
  return pathSegments(path).slice(0, -1).join('/');
}
