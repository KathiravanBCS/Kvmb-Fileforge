/** File-type filters of the list endpoints, by the (lowercase) extension stored with each file. */
export const FILE_TYPE_FILTERS = [
  'image',
  'pdf',
  'document',
  'spreadsheet',
  'presentation',
  'text',
  'archive',
  'other',
] as const;
export type FileTypeFilter = (typeof FILE_TYPE_FILTERS)[number];

const EXTENSIONS: Record<Exclude<FileTypeFilter, 'other'>, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff', 'heic'],
  pdf: ['pdf'],
  document: ['doc', 'docx', 'odt', 'rtf'],
  spreadsheet: ['xls', 'xlsx', 'ods', 'csv'],
  presentation: ['ppt', 'pptx', 'odp'],
  text: ['txt', 'md', 'json', 'xml', 'log'],
  archive: ['zip', '7z', 'rar', 'gz', 'tar'],
};

const KNOWN = Object.values(EXTENSIONS).flat();

/** A Prisma `where` fragment for one type filter. `other` is everything not in the lists above (and files without one). */
export function typeFilter(type: FileTypeFilter) {
  if (type === 'other') {
    return { OR: [{ file_extension: null }, { file_extension: { notIn: KNOWN } }] };
  }
  return { file_extension: { in: EXTENSIONS[type] } };
}
