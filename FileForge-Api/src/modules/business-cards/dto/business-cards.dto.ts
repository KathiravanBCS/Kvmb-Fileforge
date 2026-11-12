import { z } from 'zod';

import { ApiProperty } from '@nestjs/swagger';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../contacts/contacts.constants';

export const SCAN_STATUSES = ['pending', 'approved', 'rejected'] as const;

/** Query of GET /workspaces/:workspaceId/business-cards. Only the caller's own scans are ever listed. */
export const scanListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  status: z.enum(SCAN_STATUSES).optional(),
});
export type ScanListQuery = z.infer<typeof scanListQuerySchema>;

/** Query of GET .../business-cards/:id/image. */
export const imageQuerySchema = z.object({ side: z.enum(['front', 'back']).default('front') });

export class BusinessCardAddressDto {
  @ApiProperty({ type: String, nullable: true, example: '12 Anna Salai' })
  line1: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Chennai' })
  city: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Tamil Nadu' })
  state: string | null;
  @ApiProperty({ type: String, nullable: true, example: '600002' })
  postalCode: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'India' })
  country: string | null;
}

export class BusinessCardSocialLinksDto {
  @ApiProperty({ type: String, nullable: true, example: null })
  linkedin: string | null;
  @ApiProperty({ type: String, nullable: true, example: null })
  github: string | null;
}

export class BusinessCardDataDto {
  @ApiProperty({ type: String, nullable: true, example: 'Arun Kumar' })
  fullName: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Software Developer' })
  jobTitle: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'ABC Technologies' })
  companyName: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Engineering' })
  department: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'arun@example.com' })
  email: string | null;
  @ApiProperty({ type: String, nullable: true, example: '+91 9876543210' })
  mobile: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'https://example.com' })
  website: string | null;
  @ApiProperty({ type: BusinessCardAddressDto })
  address: BusinessCardAddressDto;
  @ApiProperty({ type: BusinessCardSocialLinksDto })
  socialLinks: BusinessCardSocialLinksDto;
}

/** Body of PATCH: any subset of the card data (also inside address and socialLinks). */
export class BusinessCardPatchDto {
  @ApiProperty({ required: false, nullable: true, example: 'Arun Kumar' })
  fullName?: string | null;
  @ApiProperty({ required: false, nullable: true })
  jobTitle?: string | null;
  @ApiProperty({ required: false, nullable: true })
  companyName?: string | null;
  @ApiProperty({ required: false, nullable: true })
  department?: string | null;
  @ApiProperty({ required: false, nullable: true })
  email?: string | null;
  @ApiProperty({ required: false, nullable: true })
  mobile?: string | null;
  @ApiProperty({ required: false, nullable: true })
  website?: string | null;
  @ApiProperty({ required: false, type: BusinessCardAddressDto })
  address?: Partial<BusinessCardAddressDto>;
  @ApiProperty({ required: false, type: BusinessCardSocialLinksDto })
  socialLinks?: Partial<BusinessCardSocialLinksDto>;
}

export class BusinessCardDto {
  @ApiProperty({ example: '12', description: 'BIGINT as a decimal string. This is the entity id contacts link to.' })
  id: string;
  @ApiProperty({ example: 'pending', enum: SCAN_STATUSES })
  status: string;
  @ApiProperty({ type: BusinessCardDataDto, description: 'What was read from the card, as corrected so far.' })
  data: BusinessCardDataDto;
  @ApiProperty({ example: '7', description: "The front photo in central storage (the administrator's OneDrive)." })
  imageFileId: string;
  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'The photo of the back, when there is one.',
  })
  backImageFileId: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'The contact it created or updated, once approved.',
  })
  contactId: string | null;
  @ApiProperty({ example: 'qwen/qwen3.8-27b' })
  model: string;
  @ApiProperty()
  createdAt: string;
  @ApiProperty({ type: String, nullable: true })
  reviewedAt: string | null;
}

export class BusinessCardPageDto {
  @ApiProperty({ type: [BusinessCardDto] })
  items: BusinessCardDto[];
  @ApiProperty({ example: 1 })
  page: number;
  @ApiProperty({ example: 25 })
  pageSize: number;
  @ApiProperty({ example: 1 })
  total: number;
}
