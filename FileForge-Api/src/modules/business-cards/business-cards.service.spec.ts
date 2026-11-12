import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import { emptyBusinessCardData, sanitizeExtraction } from './business-card.data';
import { BusinessCardsService, splitName, toPerson, type ScanContext } from './business-cards.service';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

function tempFile(bytes: Buffer, name = 'card.png') {
  const path = join(mkdtempSync(join(tmpdir(), 'bc-spec-')), name);
  writeFileSync(path, bytes);
  return { path, originalName: name, size: bytes.length };
}

const ctx: ScanContext = {
  workspaceId: '1',
  user: { id: '7', email: 'a@example.com', displayName: null },
  actor: { userId: 7n, isAdmin: false },
};

function setup() {
  const prisma = {
    business_card_scans: { create: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const extractor = {
    extract: jest.fn().mockResolvedValue({ data: sanitizeExtraction({ fullName: 'Arun' }), raw: {}, model: 'm' }),
  };
  const files = {
    upload: jest.fn().mockResolvedValue({ id: '55' }),
    remove: jest.fn().mockResolvedValue(undefined),
    preview: jest.fn().mockResolvedValue({ filename: 'card.png' }),
  };
  const service = new BusinessCardsService(prisma as never, extractor as never, files as never, {} as never);
  return { service, prisma, extractor, files };
}

const rowWith = (data: unknown, overrides: Record<string, unknown> = {}) => ({
  id: 3n,
  workspace_id: 1n,
  owner_user_id: 7n,
  central_file_id: 55n,
  contact_id: null,
  normalized_data: data,
  extraction_model: 'm',
  review_status: 'pending',
  reviewed_at: null,
  created_at: new Date('2026-11-12T10:00:00Z'),
  ...overrides,
});

describe('splitName', () => {
  it.each([
    ['Arun Kumar', 'Arun', 'Kumar'],
    ['Mary Ann Smith', 'Mary Ann', 'Smith'],
    ['  Priya  ', 'Priya', null],
    ['', null, null],
    [null, null, null],
  ])('%j -> %j / %j', (input, first, last) => {
    expect(splitName(input)).toEqual({ firstName: first, lastName: last });
  });
});

describe('toPerson', () => {
  it('turns card data into a contact: name parts, typed methods and an address', () => {
    const person = toPerson(
      sanitizeExtraction({
        fullName: 'Arun Kumar',
        jobTitle: 'Software Developer',
        companyName: 'ABC Technologies',
        department: 'Engineering',
        email: 'arun@example.com',
        mobile: '+91 9876543210',
        website: 'https://example.com',
        address: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
        socialLinks: { linkedin: 'https://linkedin.com/in/arun', github: null },
      }),
    );
    expect(person).toMatchObject({
      displayName: 'Arun Kumar',
      firstName: 'Arun',
      lastName: 'Kumar',
      organization: 'ABC Technologies',
      jobTitle: 'Software Developer',
      department: 'Engineering',
      address: { line1: null, city: 'Chennai', region: 'Tamil Nadu', postalCode: null, country: 'India' },
    });
    expect(person.methods).toEqual([
      { type: 'email', label: 'work', value: 'arun@example.com' },
      { type: 'phone', label: 'mobile', value: '+91 9876543210' },
      { type: 'website', label: 'work', value: 'https://example.com' },
      { type: 'social', label: 'linkedin', value: 'https://linkedin.com/in/arun' },
    ]);
  });

  it('names a card without a person after its company, then e-mail, then number', () => {
    const base = emptyBusinessCardData();
    expect(toPerson({ ...base, companyName: 'ABC', email: 'a@b.co' }).displayName).toBe('ABC');
    expect(toPerson({ ...base, email: 'a@b.co' }).displayName).toBe('a@b.co');
    expect(toPerson({ ...base, mobile: '+91 12345' }).displayName).toBe('+91 12345');
  });

  it('has no address when the card shows none', () => {
    expect(toPerson({ ...emptyBusinessCardData(), fullName: 'A B' }).address).toBeNull();
  });
});

describe('BusinessCardsService.scan', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('reads the card BEFORE storing the photo, then records a pending scan', async () => {
    const { service, prisma, extractor, files } = setup();
    prisma.business_card_scans.create.mockImplementation(async ({ data }) => rowWith(data.normalized_data));
    const calls: string[] = [];
    extractor.extract.mockImplementation(async () => {
      calls.push('extract');
      return { data: sanitizeExtraction({ fullName: 'Arun' }), raw: {}, model: 'm' };
    });
    files.upload.mockImplementation(async () => {
      calls.push('upload');
      return { id: '55' };
    });

    const view = await service.scan(ctx, { front: tempFile(PNG) });

    expect(calls).toEqual(['extract', 'upload']);
    expect(extractor.extract).toHaveBeenCalledWith([{ bytes: expect.any(Buffer), mimeType: 'image/png' }], undefined);
    expect(prisma.business_card_scans.create.mock.calls[0][0].data).toMatchObject({
      workspace_id: 1n,
      owner_user_id: 7n,
      central_file_id: 55n,
    });
    expect(view.status).toBe('pending');
    expect(view.imageFileId).toBe('55');
  });

  it('refuses a file whose BYTES are not a JPG, PNG or WebP, whatever its name says', async () => {
    const { service, extractor, files } = setup();
    for (const bytes of [Buffer.from('%PDF-1.4 hello'), Buffer.from('GIF89a......'), Buffer.from('plain text')]) {
      await expect(service.scan(ctx, { front: tempFile(bytes, 'card.png') })).rejects.toMatchObject({ status: 415 });
    }
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(files.upload).not.toHaveBeenCalled();
  });

  it('stores nothing when the card cannot be read', async () => {
    const { service, extractor, files, prisma } = setup();
    extractor.extract.mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }));
    await expect(service.scan(ctx, { front: tempFile(PNG) })).rejects.toThrow('rate limited');
    expect(files.upload).not.toHaveBeenCalled();
    expect(prisma.business_card_scans.create).not.toHaveBeenCalled();
  });

  it('removes the uploaded photo when the record cannot be saved, and still reports the original error', async () => {
    const { service, prisma, files } = setup();
    prisma.business_card_scans.create.mockRejectedValue(new Error('db down'));
    await expect(service.scan(ctx, { front: tempFile(PNG) })).rejects.toThrow('db down');
    expect(files.remove).toHaveBeenCalledWith(ctx.actor, '55');
  });

  it('does not hide the original error when the cleanup fails too', async () => {
    const { service, prisma, files } = setup();
    prisma.business_card_scans.create.mockRejectedValue(new Error('db down'));
    files.remove.mockRejectedValue(new Error('onedrive down'));
    await expect(service.scan(ctx, { front: tempFile(PNG) })).rejects.toThrow('db down');
  });
});

describe('BusinessCardsService.approve / reject', () => {
  it('answers 404 for an unknown, foreign or malformed id', async () => {
    const { service, prisma } = setup();
    prisma.business_card_scans.findFirst.mockResolvedValue(null);
    await expect(service.approve(ctx, '999')).rejects.toMatchObject({ status: 404 });
    await expect(service.get(ctx, 'abc')).rejects.toMatchObject({ status: 404 });
    await expect(service.get(ctx, '9223372036854775808')).rejects.toMatchObject({ status: 404 });
  });

  it('scopes every lookup to the signed-in user and the workspace in the URL', async () => {
    const { service, prisma } = setup();
    prisma.business_card_scans.findFirst.mockResolvedValue(null);
    await service.get(ctx, '3').catch(() => undefined);
    expect(prisma.business_card_scans.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 3n,
      workspace_id: 1n,
      owner_user_id: 7n,
      is_deleted: false,
    });
  });

  it('refuses to approve a card with nothing to save (422), without touching contacts', async () => {
    const { service, prisma } = setup();
    prisma.business_card_scans.findFirst.mockResolvedValue(rowWith(emptyBusinessCardData()));
    await expect(service.approve(ctx, '3')).rejects.toMatchObject({ status: 422 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('answers 409 for a card that was already approved or rejected', async () => {
    const { service, prisma } = setup();
    prisma.business_card_scans.findFirst.mockResolvedValue(rowWith({}, { review_status: 'approved' }));
    await expect(service.approve(ctx, '3')).rejects.toMatchObject({ status: 409 });
  });

  it('answers 409 when the card was reviewed in the meantime (nothing left to reject)', async () => {
    const { service, prisma } = setup();
    prisma.business_card_scans.findFirst.mockResolvedValue(rowWith({}));
    prisma.business_card_scans.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.reject(ctx, '3')).rejects.toMatchObject({ status: 409 });
  });
});

describe('BusinessCardsService.scan: a card with a back', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('reads both photos TOGETHER (front first), stores both, and records the back on the scan', async () => {
    const { service, prisma, extractor, files } = setup();
    files.upload.mockResolvedValueOnce({ id: '55' }).mockResolvedValueOnce({ id: '56' });
    prisma.business_card_scans.create.mockImplementation(async ({ data }) =>
      rowWith(data.normalized_data, { back_central_file_id: data.back_central_file_id }),
    );

    const view = await service.scan(ctx, { front: tempFile(PNG, 'front.png'), back: tempFile(PNG, 'back.png') });

    expect(extractor.extract).toHaveBeenCalledTimes(1);
    expect(extractor.extract.mock.calls[0][0]).toEqual([
      { bytes: expect.any(Buffer), mimeType: 'image/png' },
      { bytes: expect.any(Buffer), mimeType: 'image/png' },
    ]);
    expect(files.upload).toHaveBeenCalledTimes(2);
    expect(prisma.business_card_scans.create.mock.calls[0][0].data).toMatchObject({
      central_file_id: 55n,
      back_central_file_id: 56n,
    });
    expect(view.imageFileId).toBe('55');
    expect(view.backImageFileId).toBe('56');
  });

  it('has no back photo when none was given', async () => {
    const { service, prisma } = setup();
    prisma.business_card_scans.create.mockImplementation(async ({ data }) =>
      rowWith(data.normalized_data, { back_central_file_id: data.back_central_file_id }),
    );
    const view = await service.scan(ctx, { front: tempFile(PNG) });
    expect(prisma.business_card_scans.create.mock.calls[0][0].data.back_central_file_id).toBeNull();
    expect(view.backImageFileId).toBeNull();
  });

  it('refuses a back that is not an image before reading or storing anything', async () => {
    const { service, extractor, files } = setup();
    await expect(
      service.scan(ctx, { front: tempFile(PNG), back: tempFile(Buffer.from('%PDF-1.4 nope'), 'back.png') }),
    ).rejects.toMatchObject({ status: 415 });
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(files.upload).not.toHaveBeenCalled();
  });

  it('removes the front again when the back cannot be stored', async () => {
    const { service, prisma, files } = setup();
    files.upload.mockResolvedValueOnce({ id: '55' }).mockRejectedValueOnce(new Error('onedrive down'));
    await expect(service.scan(ctx, { front: tempFile(PNG), back: tempFile(PNG) })).rejects.toThrow('onedrive down');
    expect(files.remove).toHaveBeenCalledTimes(1);
    expect(files.remove).toHaveBeenCalledWith(ctx.actor, '55');
    expect(prisma.business_card_scans.create).not.toHaveBeenCalled();
  });

  it('removes BOTH photos when the record cannot be saved', async () => {
    const { service, prisma, files } = setup();
    files.upload.mockResolvedValueOnce({ id: '55' }).mockResolvedValueOnce({ id: '56' });
    prisma.business_card_scans.create.mockRejectedValue(new Error('db down'));
    await expect(service.scan(ctx, { front: tempFile(PNG), back: tempFile(PNG) })).rejects.toThrow('db down');
    expect(files.remove.mock.calls.map((call) => call[1]).sort()).toEqual(['55', '56']);
  });

  it('stores nothing when the card cannot be read, however many photos it has', async () => {
    const { service, extractor, files } = setup();
    extractor.extract.mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }));
    await expect(service.scan(ctx, { front: tempFile(PNG), back: tempFile(PNG) })).rejects.toThrow('rate limited');
    expect(files.upload).not.toHaveBeenCalled();
  });
});

describe('BusinessCardsService.image', () => {
  it('serves the front by default and the back on request, each from its own file', async () => {
    const { service, prisma, files } = setup();
    prisma.business_card_scans.findFirst.mockResolvedValue(rowWith({}, { back_central_file_id: 56n }));
    await service.image(ctx, '3');
    expect(files.preview).toHaveBeenLastCalledWith(ctx.actor, '55');
    await service.image(ctx, '3', 'back');
    expect(files.preview).toHaveBeenLastCalledWith(ctx.actor, '56');
  });

  it('answers 404 for the back of a card that has none', async () => {
    const { service, prisma, files } = setup();
    prisma.business_card_scans.findFirst.mockResolvedValue(rowWith({}, { back_central_file_id: null }));
    await expect(service.image(ctx, '3', 'back')).rejects.toMatchObject({ status: 404 });
    expect(files.preview).not.toHaveBeenCalled();
  });
});
