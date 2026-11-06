import {
  assertAllowedFileName,
  assertUploadSize,
  assertValidItemName,
  attachmentDisposition,
  itemPath,
  joinPath,
  parseRelativePath,
} from './onedrive-paths';
import { MAX_UPLOAD_BYTES } from './onedrive.constants';

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { response?: { code?: string } }).response?.code;
  }
  return undefined;
};

describe('parseRelativePath', () => {
  it('treats an empty or missing path as the FileForge root only where the root is allowed', () => {
    expect(parseRelativePath(undefined, { allowRoot: true })).toEqual([]);
    expect(parseRelativePath('', { allowRoot: true })).toEqual([]);
    expect(codeOf(() => parseRelativePath('', { allowRoot: false }))).toBe('INVALID_PATH');
    expect(codeOf(() => parseRelativePath(undefined, { allowRoot: false }))).toBe('INVALID_PATH');
  });

  it('accepts ordinary nested paths, including spaces, dots and unicode', () => {
    expect(parseRelativePath('invoices/2026/Q1 report.final.pdf', { allowRoot: false })).toEqual([
      'invoices',
      '2026',
      'Q1 report.final.pdf',
    ]);
    expect(parseRelativePath('résumé/データ/ファイル.txt', { allowRoot: false })).toHaveLength(3);
  });

  it('normalizes unicode so visually identical names are one name', () => {
    expect(parseRelativePath('cafe\u0301.txt', { allowRoot: false })).toEqual(['caf\u00e9.txt']);
  });

  it.each([
    ['parent traversal', '../secrets'],
    ['hidden traversal', 'invoices/../../other'],
    ['current directory', './a'],
    ['a lone dot segment', 'a/./b'],
    ['an absolute path', '/etc/passwd'],
    ['a trailing slash', 'invoices/'],
    ['an empty segment', 'a//b'],
    ['a backslash', 'a\\b'],
    ['a drive letter', 'C:/Windows'],
    ['a NUL byte', 'a\u0000.txt'],
    ['a newline', 'a\nb.txt'],
    ['a right-to-left override', 'evil\u202Efdp.exe'],
    ['a wildcard', 'a*.txt'],
    ['a query character', 'a?.txt'],
    ['a pipe', 'a|b'],
    ['an angle bracket', '<script>.txt'],
    ['a quote', 'a"b'],
    ['a trailing space', 'a .txt '],
    ['a trailing period', 'name.'],
    ['a Word lock-file name', '~$report.docx'],
    ['a reserved Windows name', 'con'],
    ['a reserved name with an extension', 'AUX.txt'],
    ['an OneDrive internal name', 'a_vti_b'],
    ['desktop.ini', 'desktop.ini'],
  ])('rejects %s', (_label, path) => {
    expect(codeOf(() => parseRelativePath(path, { allowRoot: false }))).toBe('INVALID_PATH');
  });

  it('rejects absurd lengths and depths', () => {
    expect(codeOf(() => parseRelativePath('a'.repeat(256), { allowRoot: false }))).toBe('INVALID_PATH');
    expect(codeOf(() => parseRelativePath(Array(20).fill('a').join('/'), { allowRoot: false }))).toBe('INVALID_PATH');
    expect(codeOf(() => parseRelativePath(Array(60).fill('abcdefgh').join('/'), { allowRoot: false }))).toBe(
      'INVALID_PATH',
    );
  });

  it.each([
    ['an array (repeated query parameter)', ['a', 'b']],
    ['an object', { a: 1 }],
    ['a number', 5],
  ])('rejects %s instead of coercing it', (_label, value) => {
    expect(codeOf(() => parseRelativePath(value, { allowRoot: true }))).toBe('INVALID_PATH');
  });
});

describe('assertValidItemName', () => {
  it('accepts normal names and rejects empty and overlong ones', () => {
    expect(() => assertValidItemName('report 2026.pdf')).not.toThrow();
    expect(codeOf(() => assertValidItemName(''))).toBe('INVALID_PATH');
    expect(codeOf(() => assertValidItemName('x'.repeat(256)))).toBe('INVALID_PATH');
    expect(() => assertValidItemName('x'.repeat(255))).not.toThrow();
  });
});

describe('assertAllowedFileName', () => {
  it.each(['exe', 'bat', 'cmd', 'ps1', 'vbs', 'js', 'jar', 'msi', 'dll', 'lnk', 'scr', 'sh', 'EXE'])(
    'blocks .%s files',
    (extension) => {
      expect(codeOf(() => assertAllowedFileName(`file.${extension}`))).toBe('FILE_TYPE_NOT_ALLOWED');
    },
  );

  it('decides by the final extension, so a disguised executable is caught', () => {
    expect(codeOf(() => assertAllowedFileName('invoice.pdf.exe'))).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(() => assertAllowedFileName('setup.exe.pdf')).not.toThrow();
  });

  it.each(['a.pdf', 'photo.jpg', 'sheet.xlsx', 'notes.txt', 'card.png', 'README', '.gitignore', 'archive.tar.gz'])(
    'allows %s',
    (name) => {
      expect(() => assertAllowedFileName(name)).not.toThrow();
    },
  );

  it('still applies the name rules', () => {
    expect(codeOf(() => assertAllowedFileName('a/b.pdf'))).toBe('INVALID_PATH');
  });
});

describe('assertUploadSize', () => {
  it('accepts 1 byte up to the limit, rejects empty and oversized', () => {
    expect(() => assertUploadSize(1)).not.toThrow();
    expect(() => assertUploadSize(MAX_UPLOAD_BYTES)).not.toThrow();
    expect(codeOf(() => assertUploadSize(0))).toBe('EMPTY_FILE');
    expect(codeOf(() => assertUploadSize(MAX_UPLOAD_BYTES + 1))).toBe('FILE_TOO_LARGE');
  });
});

describe('itemPath', () => {
  it('addresses the root item itself, its children and content', () => {
    expect(itemPath('d1', 'r1', [])).toBe('/drives/d1/items/r1');
    expect(itemPath('d1', 'r1', [], '/children')).toBe('/drives/d1/items/r1/children');
    expect(itemPath('d1', 'r1', ['invoices', 'a.pdf'])).toBe('/drives/d1/items/r1:/invoices/a.pdf');
    expect(itemPath('d1', 'r1', ['invoices', 'a.pdf'], '/content')).toBe(
      '/drives/d1/items/r1:/invoices/a.pdf:/content',
    );
  });

  it('percent-encodes every segment so characters cannot change the URL structure', () => {
    const path = itemPath('d1', 'r1', ['a b', 'c#d', 'e%2Ff', 'g?h=1'], '/content');
    expect(path).toBe('/drives/d1/items/r1:/a%20b/c%23d/e%252Ff/g%3Fh%3D1:/content');
    expect(path).not.toMatch(/#|\?/);
  });

  it('encodes the stored ids too', () => {
    expect(itemPath('b!a/d', 'x y', [])).toBe('/drives/b!a%2Fd/items/x%20y');
  });
});

describe('joinPath / attachmentDisposition', () => {
  it('joins segments back into the browser-facing path', () => {
    expect(joinPath(['a', 'b.txt'])).toBe('a/b.txt');
    expect(joinPath([])).toBe('');
  });

  it('always forces a download and cannot be used for header injection', () => {
    const header = attachmentDisposition('résumé "final"\r\nSet-Cookie: x=1.pdf');
    expect(header.startsWith('attachment;')).toBe(true);
    expect(header).not.toMatch(/inline/i);
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9");
    expect(header).not.toContain('"final"');
  });

  it('keeps plain ASCII names readable', () => {
    expect(attachmentDisposition('invoice-001.pdf')).toBe(
      'attachment; filename="invoice-001.pdf"; filename*=UTF-8\'\'invoice-001.pdf',
    );
  });
});
