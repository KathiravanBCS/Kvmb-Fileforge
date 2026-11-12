import { readFile } from 'node:fs/promises';

import { HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import type { SessionUser } from '../../common/types/session.types';
import { describeError } from '../../common/utils/logging.util';
import { PrismaService } from '../../prisma/prisma.service';
import { sniffMime } from '../central-storage/central-file-content';
import { CentralStorageService, type DownloadedCentralFile } from '../central-storage/central-storage.service';
import type { Actor, IncomingFile } from '../central-storage/types/central-storage.types';
import { CONTACT_SOURCE_BUSINESS_CARD, ENTITY_BUSINESS_CARD_SCAN } from '../contacts/contacts.constants';
import { ContactsService } from '../contacts/contacts.service';
import type { ContactPerson } from '../contacts/contacts.types';
import { BusinessCardExtractorService, type CardImage } from './business-card-extractor.service';
import {
  applyPatch,
  hasContactInformation,
  sanitizeExtraction,
  type BusinessCardData,
  type BusinessCardPatch,
} from './business-card.data';
import type { ScanListQuery } from './dto/business-cards.dto';

/** Image types a card photo may have. The type comes from the file's BYTES, never from its name or the browser. */
const CARD_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const BIGINT_MAX = 9223372036854775807n;
const LIVE = { is_deleted: false } as const;

export interface BusinessCardView {
  /** BIGINT as a decimal string. This is the entity id a linked contact points at. */
  id: string;
  status: string;
  data: BusinessCardData;
  /** The image in central storage. */
  imageFileId: string;
  /** The photo of the back of the card, when there is one. */
  backImageFileId: string | null;
  contactId: string | null;
  model: string;
  createdAt: string;
  reviewedAt: string | null;
}

export interface BusinessCardPage {
  items: BusinessCardView[];
  page: number;
  pageSize: number;
  total: number;
}

/** The photos of ONE card: the front, and the back when there is one. */
export interface ScanFiles {
  front: IncomingFile;
  back?: IncomingFile;
}

export type CardSide = 'front' | 'back';

export interface ScanContext {
  workspaceId: string;
  user: SessionUser;
  /** An ordinary-user actor for central storage (ownership of the image is the signed-in user). */
  actor: Actor;
}

const notFound = () => new NotFoundException({ code: 'SCAN_NOT_FOUND', message: 'Business card not found.' });
const conflict = (code: string, message: string) => new HttpException({ code, message }, 409);

function parseId(raw: string): bigint {
  if (!/^\d{1,19}$/.test(raw) || BigInt(raw) > BIGINT_MAX) throw notFound();
  return BigInt(raw);
}

type ScanRow = Prisma.business_card_scansGetPayload<object>;

/**
 * Scanning business cards: photo -> text fields -> review -> contact. A scan belongs to the user who made it (and their
 * workspace); the image lives in central storage, owned by that user; approving it saves the data into the centralized contacts
 * and links the contact to the scan (entity type `business_card_scan`, entity id = the scan id).
 */
@Injectable()
export class BusinessCardsService {
  private readonly logger = new Logger(BusinessCardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly extractor: BusinessCardExtractorService,
    private readonly files: CentralStorageService,
    private readonly contacts: ContactsService,
  ) {}

  /**
   * Reads the card (front and, if given, back TOGETHER), stores the photo(s) in central storage and records a PENDING scan. The
   * card is read first, so a failure there (not configured, rate limited, unreadable) stores nothing. If anything fails after an
   * upload, every photo uploaded for this card is removed again.
   */
  async scan(ctx: ScanContext, files: ScanFiles, signal?: AbortSignal): Promise<BusinessCardView> {
    const images = await Promise.all(
      [files.front, ...(files.back ? [files.back] : [])].map((file) => readCardImage(file)),
    );
    const extraction = await this.extractor.extract(images, signal);

    const uploaded: string[] = [];
    try {
      const front = await this.files.upload(ctx.actor, null, files.front, signal);
      uploaded.push(front.id);
      const back = files.back ? await this.files.upload(ctx.actor, null, files.back, signal) : null;
      if (back) uploaded.push(back.id);

      const row = await this.prisma.business_card_scans.create({
        data: {
          workspace_id: BigInt(ctx.workspaceId),
          owner_user_id: BigInt(ctx.user.id),
          central_file_id: BigInt(front.id),
          back_central_file_id: back ? BigInt(back.id) : null,
          raw_extraction: extraction.raw as Prisma.InputJsonValue,
          normalized_data: extraction.data,
          extraction_model: extraction.model,
          created_by: BigInt(ctx.user.id),
        },
      });
      return toView(row);
    } catch (error) {
      for (const fileId of uploaded) {
        await this.files.remove(ctx.actor, fileId).catch((cleanup: unknown) => {
          this.logger.error({ event: 'business_card_orphan_upload', fileId, cause: describeError(cleanup) });
        });
      }
      throw error;
    }
  }

  async list(ctx: ScanContext, query: ScanListQuery): Promise<BusinessCardPage> {
    const where: Prisma.business_card_scansWhereInput = {
      workspace_id: BigInt(ctx.workspaceId),
      owner_user_id: BigInt(ctx.user.id),
      ...LIVE,
      ...(query.status ? { review_status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.business_card_scans.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.business_card_scans.count({ where }),
    ]);
    return { items: rows.map(toView), page: query.page, pageSize: query.pageSize, total };
  }

  async get(ctx: ScanContext, rawId: string): Promise<BusinessCardView> {
    return toView(await this.findOwned(ctx, rawId));
  }

  /** One side's photo, for the owner. Delivered through central storage, so its viewing rules (and audit) apply. */
  async image(ctx: ScanContext, rawId: string, side: CardSide = 'front'): Promise<DownloadedCentralFile> {
    const scan = await this.findOwned(ctx, rawId);
    const fileId = side === 'back' ? scan.back_central_file_id : scan.central_file_id;
    if (fileId === null) {
      throw new NotFoundException({ code: 'IMAGE_NOT_FOUND', message: 'This card has no photo of its back.' });
    }
    return this.files.preview(ctx.actor, fileId.toString());
  }

  /** Corrects what was read. Only a pending scan can be edited; only the fields that are sent change. */
  async update(ctx: ScanContext, rawId: string, patch: BusinessCardPatch): Promise<BusinessCardView> {
    const scan = await this.findOwned(ctx, rawId);
    const next = applyPatch(sanitizeExtraction(scan.normalized_data), patch);
    const { count } = await this.prisma.business_card_scans.updateMany({
      where: { id: scan.id, review_status: 'pending', ...LIVE },
      data: { normalized_data: next, updated_by: BigInt(ctx.user.id) },
    });
    if (count === 0) throw this.alreadyReviewed();
    return this.get(ctx, rawId);
  }

  /** Saves the card as a contact (or adds it to the contact that already has the same e-mail) and links the two. */
  async approve(ctx: ScanContext, rawId: string): Promise<BusinessCardView> {
    const scan = await this.findOwned(ctx, rawId);
    if (scan.review_status !== 'pending') throw this.alreadyReviewed();

    const data = sanitizeExtraction(scan.normalized_data);
    if (!hasContactInformation(data)) {
      throw new HttpException(
        { code: 'NOTHING_TO_SAVE', message: 'Add a name, company, e-mail or phone number before saving the contact.' },
        422,
      );
    }

    const userId = BigInt(ctx.user.id);
    await this.prisma.$transaction(async (tx) => {
      const { contactId } = await this.contacts.saveFromSource(tx, {
        workspaceId: scan.workspace_id,
        userId,
        entityTypeCode: ENTITY_BUSINESS_CARD_SCAN,
        entityId: scan.id,
        sourceTypeCode: CONTACT_SOURCE_BUSINESS_CARD,
        person: toPerson(data),
      });
      // Claims the scan: if a second approval got here first, nothing matches, and the contact work above is rolled back.
      const { count } = await tx.business_card_scans.updateMany({
        where: { id: scan.id, review_status: 'pending', ...LIVE },
        data: { review_status: 'approved', contact_id: contactId, reviewed_at: new Date(), updated_by: userId },
      });
      if (count === 0) throw this.alreadyReviewed();
    });
    return this.get(ctx, rawId);
  }

  /** Discards the card without creating a contact. The photo stays in central storage until its owner deletes it. */
  async reject(ctx: ScanContext, rawId: string): Promise<BusinessCardView> {
    const scan = await this.findOwned(ctx, rawId);
    const { count } = await this.prisma.business_card_scans.updateMany({
      where: { id: scan.id, review_status: 'pending', ...LIVE },
      data: { review_status: 'rejected', reviewed_at: new Date(), updated_by: BigInt(ctx.user.id) },
    });
    if (count === 0) throw this.alreadyReviewed();
    return this.get(ctx, rawId);
  }

  private alreadyReviewed(): HttpException {
    return conflict('SCAN_ALREADY_REVIEWED', 'This card has already been saved or discarded.');
  }

  /** A scan is only ever visible to the user who made it, inside the workspace in the URL. Anything else is "not found". */
  private async findOwned(ctx: ScanContext, rawId: string): Promise<ScanRow> {
    const row = await this.prisma.business_card_scans.findFirst({
      where: {
        id: parseId(rawId),
        workspace_id: BigInt(ctx.workspaceId),
        owner_user_id: BigInt(ctx.user.id),
        ...LIVE,
      },
    });
    if (!row) throw notFound();
    return row;
  }
}

function toView(row: ScanRow): BusinessCardView {
  return {
    id: row.id.toString(),
    status: row.review_status,
    data: sanitizeExtraction(row.normalized_data),
    imageFileId: row.central_file_id.toString(),
    backImageFileId: row.back_central_file_id?.toString() ?? null,
    contactId: row.contact_id?.toString() ?? null,
    model: row.extraction_model,
    createdAt: row.created_at.toISOString(),
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
  };
}

/** Reads a photo and decides its type from its BYTES. Anything but JPG, PNG or WebP is refused (415). */
async function readCardImage(file: IncomingFile): Promise<CardImage> {
  const bytes = await readFile(file.path);
  const mimeType = sniffMime(bytes.subarray(0, 64));
  if (!mimeType || !CARD_IMAGE_TYPES.has(mimeType)) {
    throw new HttpException(
      { code: 'IMAGE_TYPE_NOT_SUPPORTED', message: 'Use a JPG, PNG or WebP photo of the card.' },
      415,
    );
  }
  return { bytes, mimeType };
}

/** "Arun Kumar" -> first "Arun", last "Kumar"; "Mary Ann Smith" -> first "Mary Ann", last "Smith"; one word -> first name only. */
export function splitName(fullName: string | null): { firstName: string | null; lastName: string | null } {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

/** The card data as the person the contacts module saves. A card without a name is saved under its company, e-mail or number. */
export function toPerson(data: BusinessCardData): ContactPerson {
  const displayName = data.fullName ?? data.companyName ?? data.email ?? data.mobile ?? 'Unnamed contact';
  const methods: ContactPerson['methods'] = [];
  if (data.email) methods.push({ type: 'email', label: 'work', value: data.email });
  if (data.mobile) methods.push({ type: 'phone', label: 'mobile', value: data.mobile });
  if (data.website) methods.push({ type: 'website', label: 'work', value: data.website });
  if (data.socialLinks.linkedin) methods.push({ type: 'social', label: 'linkedin', value: data.socialLinks.linkedin });
  if (data.socialLinks.github) methods.push({ type: 'social', label: 'github', value: data.socialLinks.github });

  const { line1, city, state, postalCode, country } = data.address;
  const hasAddress = Boolean(line1 || city || state || postalCode || country);
  return {
    displayName,
    ...splitName(data.fullName),
    organization: data.companyName,
    jobTitle: data.jobTitle,
    department: data.department,
    methods,
    address: hasAddress ? { line1, city, region: state, postalCode, country } : null,
  };
}
