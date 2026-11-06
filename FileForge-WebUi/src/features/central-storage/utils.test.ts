import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api-types';
import {
  describeError,
  extensionOf,
  fileKind,
  formatWait,
  isCancelled,
  isStorageBusy,
  isUploadLimitReached,
  validateCentralUpload,
  validateRename,
} from './utils';

const MAX = 50 * 1024 * 1024;
const fileOf = (name: string, size: number) => new File([new Uint8Array(Math.min(size, 16))], name, { type: 'application/octet-stream' }) as File & { size: number };
/** A File whose reported size is `size` without allocating that many bytes. */
function sized(name: string, size: number): File {
  const file = fileOf(name, 1);
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('validateCentralUpload (early feedback; the API repeats every check)', () => {
  it('accepts an ordinary file', () => expect(validateCentralUpload(sized('report.pdf', 1024), MAX)).toBeNull());
  it('accepts a file of exactly the limit', () => expect(validateCentralUpload(sized('big.pdf', MAX), MAX)).toBeNull());

  it('rejects a file over 50 MB, naming the limit', () => {
    expect(validateCentralUpload(sized('big.pdf', MAX + 1), MAX)).toMatch(/Too large: files up to 50 MB/);
  });
  it('rejects an empty file', () => expect(validateCentralUpload(sized('empty.txt', 0), MAX)).toBe('The file is empty.'));

  it.each(['setup.exe', 'run.ps1', 'a.bat', 'invoice.pdf.exe', 'x.JS', 'lib.dll'])('rejects the blocked type %s', (name) => {
    expect(validateCentralUpload(sized(name, 10), MAX)).toMatch(/cannot be stored here/);
  });

  it.each(['con.txt', 'a:b.pdf', 'a/b.pdf', 'a\\b.pdf', 'bad.', ' lead.pdf', '..', 'x'.repeat(256) + '.pdf'])(
    'rejects the unusable name %j',
    (name) => expect(validateCentralUpload(sized(name, 10), MAX)).not.toBeNull(),
  );
});

describe('validateRename', () => {
  it('allows a new name with the same extension', () => expect(validateRename('Final.PDF', 'draft.pdf')).toBeNull());
  it('refuses a different extension, so the stored content type never disagrees with the name', () => {
    expect(validateRename('draft.docx', 'draft.pdf')).toMatch(/extension cannot be changed/);
    expect(validateRename('draft', 'draft.pdf')).toMatch(/extension cannot be changed/);
  });
  it('refuses blocked and invalid names', () => {
    expect(validateRename('draft.exe', 'draft.exe')).toMatch(/cannot be stored here/);
    expect(validateRename('', 'draft.pdf')).not.toBeNull();
  });
});

describe('helpers', () => {
  it.each([
    ['a.PDF', 'pdf'],
    ['archive.tar.GZ', 'gz'],
    ['noextension', null],
    ['.hidden', null],
    ['trailing.', null],
  ])('extensionOf(%s) = %s', (name, expected) => expect(extensionOf(name)).toBe(expected));

  it('shows files by kind', () => {
    expect(fileKind('pdf')).toMatchObject({ label: 'PDF', color: 'red' });
    expect(fileKind('png')).toMatchObject({ label: 'Image' });
    expect(fileKind('docx').label).toBe('Word');
    expect(fileKind('xyz').label).toBe('XYZ');
    expect(fileKind(null).label).toBe('File');
  });

  it('describes errors readably, and never leaks a network error as a raw message', () => {
    expect(describeError(new ApiError('File not found.', { status: 404 }))).toBe('File not found.');
    expect(describeError(new ApiError('Unable to reach the FileForge API.', { isNetworkError: true }))).toMatch(/Unable to reach the server/);
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('weird')).toBe('Something went wrong. Please try again.');
  });

  it('tells a deliberate cancel from a failure', () => {
    const controller = new AbortController();
    controller.abort();
    expect(isCancelled(new Error('x'), controller.signal)).toBe(true);
    expect(isCancelled(Object.assign(new Error('canceled'), { name: 'CanceledError' }))).toBe(true);
    expect(isCancelled(new Error('Network down'))).toBe(false);
  });
});

describe('429 helpers', () => {
  const limited = (code: string, extra: { retryAfterSeconds?: number } = {}) =>
    new ApiError('Too many.', { status: 429, code, ...extra });

  it('formats a wait readably', () => {
    expect([1, 2, 45, 119, 120, 300, 601].map(formatWait)).toEqual([
      '1 second',
      '2 seconds',
      '45 seconds',
      '119 seconds',
      '2 minutes',
      '5 minutes',
      '11 minutes',
    ]);
  });

  it('tells "your allowance is used up" from "the server is busy" from everything else', () => {
    expect(isUploadLimitReached(limited('UPLOAD_RATE_LIMITED'))).toBe(true);
    expect(isStorageBusy(limited('UPLOAD_RATE_LIMITED'))).toBe(false);

    for (const code of ['UPLOAD_CAPACITY_BUSY', 'UPLOAD_TOO_MANY_ACTIVE', 'CENTRAL_STORAGE_THROTTLED']) {
      expect(isStorageBusy(limited(code))).toBe(true);
      expect(isUploadLimitReached(limited(code))).toBe(false);
    }
    // Same codes with another status, an unknown 429, other errors and non-errors are neither.
    expect(isStorageBusy(new ApiError('x', { status: 503, code: 'UPLOAD_CAPACITY_BUSY' }))).toBe(false);
    expect(isStorageBusy(limited('SOMETHING_ELSE'))).toBe(false);
    expect(isStorageBusy(new Error('x'))).toBe(false);
    expect(isUploadLimitReached('x')).toBe(false);
  });

  it('keeps the API message when it already says how long to wait', () => {
    const error = new ApiError('You have reached the limit of 10 uploads per 10 minutes. Try again in 5 minutes.', {
      status: 429,
      code: 'UPLOAD_RATE_LIMITED',
      retryAfterSeconds: 300,
    });
    expect(describeError(error)).toBe(error.message);
  });

  it('adds the wait to a 429 message that does not mention one', () => {
    expect(describeError(new ApiError('Storage is busy.', { status: 429, retryAfterSeconds: 45 }))).toBe(
      'Storage is busy. Try again in 45 seconds.',
    );
    expect(describeError(new ApiError('Storage is busy.', { status: 429 }))).toBe('Storage is busy.');
    // ...but not when the message already tells the person to try again.
    const polite = new ApiError('The storage is busy. Please try again shortly.', { status: 429, retryAfterSeconds: 10 });
    expect(describeError(polite)).toBe('The storage is busy. Please try again shortly.');
    expect(describeError(new ApiError('Boom.', { status: 500, retryAfterSeconds: 45 }))).toBe('Boom.');
  });
});
