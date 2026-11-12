import { z } from 'zod';

// Contracts of FileForge-Api's business card endpoints (all under /workspaces/:workspaceId/business-cards).

const text = z.string().nullable();

export const cardDataSchema = z.object({
  fullName: text,
  jobTitle: text,
  companyName: text,
  department: text,
  email: text,
  mobile: text,
  website: text,
  address: z.object({ line1: text, city: text, state: text, postalCode: text, country: text }),
  socialLinks: z.object({ linkedin: text, github: text }),
});

export const SCAN_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const businessCardSchema = z.object({
  id: z.string().regex(/^\d+$/), // BIGINT as a decimal string; also the entity id contacts link to
  status: z.enum(SCAN_STATUSES),
  data: cardDataSchema,
  imageFileId: z.string(),
  /** The photo of the back of the card, when it has one. */
  backImageFileId: z.string().nullable(),
  contactId: z.string().nullable(),
  model: z.string(),
  createdAt: z.string(),
  reviewedAt: z.string().nullable(),
});

export const businessCardPageSchema = z.object({
  items: z.array(businessCardSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});

export type CardData = z.infer<typeof cardDataSchema>;
export type BusinessCard = z.infer<typeof businessCardSchema>;
export type BusinessCardPage = z.infer<typeof businessCardPageSchema>;

/** An edit: any subset of the card data (also inside address and socialLinks). */
export type CardPatch = Partial<Omit<CardData, 'address' | 'socialLinks'>> & {
  address?: Partial<CardData['address']>;
  socialLinks?: Partial<CardData['socialLinks']>;
};

export interface BusinessCardsQuery {
  page: number;
  pageSize: number;
  status?: ScanStatus;
}

/** Same limits as the API (it refuses anything else): a phone photo, JPG / PNG / WebP, up to 10 MB. */
export const MAX_CARD_IMAGE_BYTES = 10 * 1024 * 1024;
export const CARD_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
