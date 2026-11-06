import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extensionOf, inspectContent, PREVIEW_MIME_TYPES, sniffMime } from './central-file-content';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const GIF = Buffer.from('GIF89a\u0001\u0000');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'central-content-'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

async function inspect(name: string, bytes: Buffer): Promise<string> {
  const path = join(dir, `${Math.random().toString(36).slice(2)}.bin`);
  await writeFile(path, bytes);
  return inspectContent(path, name);
}
const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as { response?: { code?: string } }).response?.code;
  }
  return undefined;
};

describe('extensionOf', () => {
  it.each([
    ['a.PDF', 'pdf'],
    ['archive.tar.GZ', 'gz'],
    ['noextension', null],
    ['.hidden', null],
    ['trailingdot.', null],
    ['weird.ex t', null],
  ])('%s -> %s', (name, expected) => expect(extensionOf(name)).toBe(expected));
});

describe('sniffMime', () => {
  it.each([
    ['pdf', PDF, 'application/pdf'],
    ['png', PNG, 'image/png'],
    ['jpeg', JPEG, 'image/jpeg'],
    ['gif', GIF, 'image/gif'],
    ['webp', WEBP, 'image/webp'],
  ])('recognises %s from its first bytes', (_label, bytes, mime) => expect(sniffMime(bytes)).toBe(mime));

  it('returns null for anything else', () =>
    expect(sniffMime(Buffer.from('<html><script>alert(1)</script>'))).toBeNull());
});

describe('inspectContent: the stored MIME type comes from the BYTES, never from the name or the browser', () => {
  it('stores image/PDF types only when the bytes confirm them', async () => {
    expect(await inspect('scan.pdf', PDF)).toBe('application/pdf');
    expect(await inspect('photo.png', PNG)).toBe('image/png');
    expect(await inspect('photo.JPG', JPEG)).toBe('image/jpeg');
    expect(await inspect('anim.gif', GIF)).toBe('image/gif');
    expect(await inspect('pic.webp', WEBP)).toBe('image/webp');
  });

  it('rejects a file whose extension promises a type its content is not', async () => {
    expect(await rejection(inspect('evil.pdf', Buffer.from('<html>not a pdf</html>')))).toBe('FILE_CONTENT_MISMATCH');
    expect(await rejection(inspect('evil.png', PDF))).toBe('FILE_CONTENT_MISMATCH');
    expect(await rejection(inspect('evil.jpg', PNG))).toBe('FILE_CONTENT_MISMATCH');
  });

  it('does NOT trust bytes under a misleading extension for previews (a PNG named .docx is not shown inline as docx)', async () => {
    // The content is a PNG, so that is what is stored: it is previewable AS A PNG, never as something the name claims.
    expect(await inspect('photo.docx', PNG)).toBe('image/png');
  });

  it('treats text as previewable only when it is valid UTF-8 without NUL bytes', async () => {
    expect(await inspect('notes.txt', Buffer.from('Hello, wörld\n'))).toBe('text/plain');
    expect(await inspect('notes.txt', Buffer.from([0x68, 0x00, 0x69]))).toBe('application/octet-stream');
    expect(await inspect('notes.txt', Buffer.from([0xff, 0xfe, 0xfd]))).toBe('application/octet-stream');
  });

  it.each(['page.html', 'vector.svg', 'script.js', 'doc.xml', 'unknown.bin', 'noextension'])(
    '%s is never previewable (HTML/SVG/scripts can run on the origin)',
    async (name) => {
      const mime = await inspect(
        name,
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      );
      expect(PREVIEW_MIME_TYPES.has(mime)).toBe(false);
    },
  );

  it('gives common office files an informational type that is still not previewable', async () => {
    const mime = await inspect('report.docx', Buffer.from('PK\u0003\u0004'));
    expect(mime).toContain('wordprocessingml');
    expect(PREVIEW_MIME_TYPES.has(mime)).toBe(false);
  });

  it('the set of previewable types is exactly images, PDF and plain text', () => {
    expect([...PREVIEW_MIME_TYPES].sort()).toEqual(
      ['application/pdf', 'image/gif', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'].sort(),
    );
  });
});
