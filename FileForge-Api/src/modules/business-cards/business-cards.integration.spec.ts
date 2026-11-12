/**
 * Integration test: the REAL business card and contact services with the REAL Prisma client against a migrated database.
 * Only the card reader (Groq) and the OneDrive upload are replaced. It is skipped unless IT_DATABASE_URL is set, and it refuses
 * any database that is not on this machine, because it creates users, workspaces and contacts.
 *
 *   1. a local, EMPTY Postgres database, then:  DATABASE_URL=<that url> npm run db:migrate:deploy
 *   2. IT_DATABASE_URL=<that url> npx jest src/modules/business-cards/business-cards.integration.spec.ts
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { PrismaClient } from '../../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { ContactsService } from '../contacts/contacts.service';
import { emptyBusinessCardData, sanitizeExtraction } from './business-card.data';
import { BusinessCardsService, type ScanContext } from './business-cards.service';

const URL = process.env['IT_DATABASE_URL'] ?? '';
const isLocal = /^postgres(ql)?:\/\/[^/]*@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(URL);
if (URL && !isLocal)
  throw new Error('IT_DATABASE_URL must point at a database on this machine (localhost / 127.0.0.1).');
const describeIf = URL ? describe : describe.skip;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);

const CARD = sanitizeExtraction({
  fullName: 'Arun Kumar',
  jobTitle: 'Software Developer',
  companyName: 'ABC Technologies',
  department: 'Engineering',
  email: 'Arun@Example.com',
  mobile: '+91 9876543210',
  website: 'https://example.com',
  address: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
  socialLinks: { linkedin: 'https://linkedin.com/in/arun', github: null },
});

describeIf('business cards + contacts against the real schema', () => {
  let pool: Pool;
  let prisma: PrismaClient;
  let cards: BusinessCardsService;
  let contacts: ContactsService;
  let ctx: ScanContext;
  let other: ScanContext;
  let connectionId: bigint;
  let extractResult: { data: ReturnType<typeof sanitizeExtraction>; raw: unknown; model: string };
  const order: string[] = [];
  let fileCounter = 0;

  const tmpImage = () => {
    const path = join(mkdtempSync(join(tmpdir(), 'bc-')), 'card.png');
    writeFileSync(path, PNG);
    return { path, originalName: 'card.png', size: PNG.length };
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL, max: 1 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const owner = await prisma.roles.findFirstOrThrow({ where: { code: 'owner' } });
    const user = await prisma.users.create({ data: { auth_provider: 'microsoft', email: 'it@example.com' } });
    const stranger = await prisma.users.create({ data: { auth_provider: 'microsoft', email: 'stranger@example.com' } });
    await prisma.user_identities.create({
      data: { user_id: user.id, provider: 'microsoft', issuer: 'iss', subject: 'sub-1', is_primary: true },
    });
    const ws = await prisma.workspaces.create({
      data: { name: 'IT', slug: `it-${user.id}`, workspace_type: 'personal', owner_user_id: user.id },
    });
    await prisma.workspace_members.create({ data: { workspace_id: ws.id, user_id: user.id, role_id: owner.id } });
    const provider = await prisma.storage_provider_types.findFirstOrThrow({ where: { code: 'onedrive' } });
    const connection = await prisma.central_connection.create({
      data: {
        provider_type_id: provider.id,
        owner_user_id: user.id,
        account_issuer: 'iss',
        account_subject: 'sub-1',
        home_account_id: 'h',
        external_drive_id: 'd',
        root_folder_item_id: 'r',
        users_folder_item_id: 'u',
        token_cache_ciphertext: Buffer.from('x'),
        token_cache_nonce: Buffer.alloc(12),
        token_cache_auth_tag: Buffer.alloc(16),
      },
    });
    connectionId = connection.id;

    const db = prisma as unknown as PrismaService;
    contacts = new ContactsService(db);
    const extractor = {
      extract: jest.fn(async () => {
        order.push('extract');
        return extractResult;
      }),
    };
    const files = {
      upload: jest.fn(async () => {
        order.push('upload');
        fileCounter += 1;
        const row = await prisma.central_files.create({
          data: {
            connection_id: connectionId,
            owner_user_id: user.id,
            uploaded_by: user.id,
            display_name: 'card.png',
            stored_name: `00000000-0000-0000-0000-${String(fileCounter).padStart(12, '0')}.png`,
            mime_type: 'image/png',
            external_drive_id: 'd',
            external_item_id: `item-${fileCounter}`,
            upload_status: 'ready',
            uploaded_at: new Date(),
          },
        });
        return { id: row.id.toString() };
      }),
      remove: jest.fn(async () => undefined),
      preview: jest.fn(async () => ({ stream: null, filename: 'card.png', mimeType: 'image/png' })),
    };
    cards = new BusinessCardsService(db, extractor as never, files as never, contacts);
    const actor = { userId: user.id, isAdmin: false };
    ctx = {
      workspaceId: ws.id.toString(),
      user: { id: user.id.toString(), email: 'it@example.com', displayName: null },
      actor,
    };
    other = {
      workspaceId: ws.id.toString(),
      user: { id: stranger.id.toString(), email: 's@example.com', displayName: null },
      actor: { userId: stranger.id, isAdmin: false },
    };
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  beforeEach(() => {
    extractResult = { data: CARD, raw: { fullName: 'Arun Kumar' }, model: 'qwen/qwen3.8-27b' };
  });

  let firstScanId = '';
  let contactId = '';

  it('scan: reads the card FIRST, then stores the photo, and records a pending scan', async () => {
    order.length = 0;
    const scan = await cards.scan(ctx, { front: tmpImage() });
    firstScanId = scan.id;
    expect(order).toEqual(['extract', 'upload']);
    expect(scan.status).toBe('pending');
    expect(scan.data.fullName).toBe('Arun Kumar');
    expect(scan.data.email).toBe('arun@example.com');
    expect(scan.contactId).toBeNull();
    expect(scan.imageFileId).toMatch(/^\d+$/);
    expect(scan.model).toBe('qwen/qwen3.8-27b');
  });

  it('scan: a card with a back stores BOTH photos (read together) and serves each side from its own file', async () => {
    order.length = 0;
    const scan = await cards.scan(ctx, { front: tmpImage(), back: tmpImage() });

    expect(order).toEqual(['extract', 'upload', 'upload']); // one reading for the whole card, then front, then back
    expect(scan.backImageFileId).toMatch(/^\d+$/);
    expect(scan.backImageFileId).not.toBe(scan.imageFileId);
    const row = await prisma.business_card_scans.findUniqueOrThrow({ where: { id: BigInt(scan.id) } });
    expect(row.central_file_id).toBe(BigInt(scan.imageFileId));
    expect(row.back_central_file_id).toBe(BigInt(scan.backImageFileId as string));

    const preview = (cards as unknown as { files: { preview: jest.Mock } }).files.preview;
    preview.mockClear();
    await cards.image(ctx, scan.id);
    await cards.image(ctx, scan.id, 'back');
    expect(preview.mock.calls.map((call) => call[1])).toEqual([scan.imageFileId, scan.backImageFileId]);
  });

  it('scan: a card without a back has no back photo, and asking for it is a 404', async () => {
    const scan = await cards.scan(ctx, { front: tmpImage() });
    expect(scan.backImageFileId).toBeNull();
    await expect(cards.image(ctx, scan.id, 'back')).rejects.toMatchObject({ status: 404 });
    const listed = (await cards.list(ctx, { page: 1, pageSize: 25 })).items.find((item) => item.id === scan.id);
    expect(listed?.backImageFileId).toBeNull();
  });

  it('isolation: nobody else can fetch the back photo either', async () => {
    const scan = await cards.scan(ctx, { front: tmpImage(), back: tmpImage() });
    await expect(cards.image(other, scan.id, 'back')).rejects.toMatchObject({ status: 404 });
  });

  it('scan: rejects a file that is not an image, before reading or storing anything', async () => {
    order.length = 0;
    const path = join(mkdtempSync(join(tmpdir(), 'bc-')), 'x.png');
    writeFileSync(path, Buffer.from('%PDF-1.4 not an image'));
    await expect(cards.scan(ctx, { front: { path, originalName: 'x.png', size: 20 } })).rejects.toMatchObject({
      status: 415,
    });
    expect(order).toEqual([]);
  });

  it('update: merges an edit into the stored data', async () => {
    const updated = await cards.update(ctx, firstScanId, { address: { city: 'Madurai', postalCode: '625001' } });
    expect(updated.data.address).toMatchObject({
      city: 'Madurai',
      state: 'Tamil Nadu',
      country: 'India',
      postalCode: '625001',
    });
    expect(updated.data.fullName).toBe('Arun Kumar');
  });

  it('approve: creates the contact with its methods, address and link back to the scan', async () => {
    const approved = await cards.approve(ctx, firstScanId);
    expect(approved.status).toBe('approved');
    expect(approved.contactId).not.toBeNull();
    contactId = approved.contactId as string;

    const contact = await contacts.get(ctx.workspaceId, contactId);
    expect(contact).toMatchObject({
      displayName: 'Arun Kumar',
      firstName: 'Arun',
      lastName: 'Kumar',
      organization: 'ABC Technologies',
      jobTitle: 'Software Developer',
      department: 'Engineering',
      reviewStatus: 'unreviewed',
      source: { type: 'business_card', recordId: firstScanId },
    });
    expect(contact.methods.map((m) => [m.type, m.label, m.value, m.isPrimary])).toEqual(
      expect.arrayContaining([
        ['email', 'work', 'arun@example.com', true],
        ['phone', 'mobile', '+91 9876543210', true],
        ['website', 'work', 'https://example.com', false],
        ['social', 'linkedin', 'https://linkedin.com/in/arun', false],
      ]),
    );
    expect(contact.addresses).toHaveLength(1);
    expect(contact.addresses[0]).toMatchObject({
      city: 'Madurai',
      region: 'Tamil Nadu',
      country: 'India',
      postalCode: '625001',
    });
    // entity type = business card scan, entity id = the scan's id
    expect(contact.links).toEqual([
      { entityType: 'business_card_scan', entityId: firstScanId, relationship: 'source' },
    ]);
  });

  it('approve: a card that was already approved cannot be approved again', async () => {
    await expect(cards.approve(ctx, firstScanId)).rejects.toMatchObject({ status: 409 });
    await expect(cards.update(ctx, firstScanId, { jobTitle: 'x' })).rejects.toMatchObject({ status: 409 });
    await expect(cards.reject(ctx, firstScanId)).rejects.toMatchObject({ status: 409 });
  });

  it('approve: a second card with the same e-mail joins the existing contact instead of duplicating it', async () => {
    extractResult = {
      model: 'qwen/qwen3.8-27b',
      raw: {},
      data: sanitizeExtraction({
        fullName: 'A. Kumar',
        jobTitle: 'Tech Lead', // the contact already has a title: must NOT be overwritten
        email: 'ARUN@example.com', // same address, different case
        mobile: '+91 8888888888', // a new number: added, not primary
        socialLinks: { github: 'https://github.com/arun' },
      }),
    };
    const second = await cards.scan(ctx, { front: tmpImage() });
    const approved = await cards.approve(ctx, second.id);
    expect(approved.contactId).toBe(contactId);

    const page = await contacts.list(ctx.workspaceId, { page: 1, pageSize: 25 });
    expect(page.total).toBe(1);
    const contact = await contacts.get(ctx.workspaceId, contactId);
    expect(contact.displayName).toBe('Arun Kumar');
    expect(contact.jobTitle).toBe('Software Developer');
    const phones = contact.methods.filter((m) => m.type === 'phone');
    expect(phones.map((p) => [p.value, p.isPrimary])).toEqual(
      expect.arrayContaining([
        ['+91 9876543210', true],
        ['+91 8888888888', false],
      ]),
    );
    expect(contact.methods.filter((m) => m.type === 'email')).toHaveLength(1);
    expect(contact.methods.some((m) => m.label === 'github')).toBe(true);
    expect(contact.addresses).toHaveLength(1);
    expect(contact.links.map((l) => l.entityId).sort()).toEqual([firstScanId, second.id].sort());
    expect(contact.source.recordId).toBe(firstScanId); // still points at where it FIRST came from
  });

  it('approve: refuses a card with nothing to save', async () => {
    extractResult = { model: 'm', raw: {}, data: emptyBusinessCardData() };
    const empty = await cards.scan(ctx, { front: tmpImage() });
    await expect(cards.approve(ctx, empty.id)).rejects.toMatchObject({ status: 422 });
    // ...but the user can type the data in and then approve
    await cards.update(ctx, empty.id, { fullName: 'Typed By Hand' });
    const approved = await cards.approve(ctx, empty.id);
    expect(approved.status).toBe('approved');
    const typed = await contacts.get(ctx.workspaceId, approved.contactId as string);
    expect(typed.displayName).toBe('Typed By Hand');
    expect(typed.methods).toEqual([]);
  });

  it('reject: no contact is created, and the card cannot be edited afterwards', async () => {
    extractResult = {
      model: 'm',
      raw: {},
      data: sanitizeExtraction({ fullName: 'Nobody Special', email: 'nobody@example.com' }),
    };
    const scan = await cards.scan(ctx, { front: tmpImage() });
    const before = (await contacts.list(ctx.workspaceId, { page: 1, pageSize: 25 })).total;
    const rejected = await cards.reject(ctx, scan.id);
    expect(rejected.status).toBe('rejected');
    expect(rejected.contactId).toBeNull();
    expect((await contacts.list(ctx.workspaceId, { page: 1, pageSize: 25 })).total).toBe(before);
    await expect(cards.update(ctx, scan.id, { jobTitle: 'x' })).rejects.toMatchObject({ status: 409 });
  });

  it("isolation: another user cannot see, edit, approve or view someone else's scan", async () => {
    await expect(cards.get(other, firstScanId)).rejects.toMatchObject({ status: 404 });
    await expect(cards.update(other, firstScanId, {})).rejects.toMatchObject({ status: 404 });
    await expect(cards.approve(other, firstScanId)).rejects.toMatchObject({ status: 404 });
    await expect(cards.image(other, firstScanId)).rejects.toMatchObject({ status: 404 });
    expect((await cards.list(other, { page: 1, pageSize: 25 })).total).toBe(0);
    // and a scan id from another workspace in the URL is not found either
    await expect(cards.get({ ...ctx, workspaceId: '999999' }, firstScanId)).rejects.toMatchObject({ status: 404 });
  });

  it('list: only my scans, newest first, filterable by status', async () => {
    const all = await cards.list(ctx, { page: 1, pageSize: 25 });
    expect(all.items.map((s) => BigInt(s.id))).toEqual(
      [...all.items.map((s) => BigInt(s.id))].sort((a, b) => (a > b ? -1 : 1)),
    );
    const approved = await cards.list(ctx, { page: 1, pageSize: 25, status: 'approved' });
    expect(approved.items.every((s) => s.status === 'approved')).toBe(true);
    expect(approved.total).toBe(3);
  });

  it('contacts: search by name, organization and e-mail; summary shows the primary e-mail and phone', async () => {
    for (const q of ['arun', 'abc tech', 'ARUN@EXAMPLE', 'typed by']) {
      expect((await contacts.list(ctx.workspaceId, { page: 1, pageSize: 25, q })).total).toBeGreaterThan(0);
    }
    expect((await contacts.list(ctx.workspaceId, { page: 1, pageSize: 25, q: 'zzz-nothing' })).total).toBe(0);
    const arun = (await contacts.list(ctx.workspaceId, { page: 1, pageSize: 25, q: 'arun' })).items[0];
    expect(arun).toMatchObject({
      email: 'arun@example.com',
      phone: '+91 9876543210',
      organization: 'ABC Technologies',
    });
  });

  it('contacts: update changes only what is sent; another workspace cannot reach the contact', async () => {
    const updated = await contacts.update(ctx.workspaceId, contactId, ctx.user.id, {
      notes: 'Met at the expo',
      department: null,
    });
    expect(updated.notes).toBe('Met at the expo');
    expect(updated.department).toBeNull();
    expect(updated.displayName).toBe('Arun Kumar');
    await expect(contacts.get('999999', contactId)).rejects.toMatchObject({ status: 404 });
  });

  it('contacts: delete is a soft delete of the contact and everything under it; the scan survives', async () => {
    await contacts.remove(ctx.workspaceId, contactId, ctx.user.id);
    await expect(contacts.get(ctx.workspaceId, contactId)).rejects.toMatchObject({ status: 404 });
    const methods = await prisma.contact_methods.findMany({ where: { contact_id: BigInt(contactId) } });
    expect(methods.length).toBeGreaterThan(0);
    expect(methods.every((m) => m.is_deleted && m.deleted_at)).toBe(true);
    const scan = await cards.get(ctx, firstScanId);
    expect(scan.status).toBe('approved');
  });

  it('a scan that fails to save removes the photo it just uploaded', async () => {
    const files = (cards as unknown as { files: { remove: jest.Mock } }).files;
    files.remove.mockClear();
    const real = prisma.business_card_scans.create;
    jest.spyOn(prisma.business_card_scans, 'create').mockRejectedValueOnce(new Error('db down'));
    await expect(cards.scan(ctx, { front: tmpImage() })).rejects.toThrow('db down');
    expect(files.remove).toHaveBeenCalledTimes(1);
    void real;
  });
});
