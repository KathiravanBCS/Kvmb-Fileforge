import { z } from 'zod';

import { ApiProperty } from '@nestjs/swagger';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../contacts.constants';

const REVIEW_STATUSES = ['unreviewed', 'reviewed', 'rejected'] as const;

const emptyToNull = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value);
const optionalText = (max: number) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable()).optional();

/** Query of GET /workspaces/:workspaceId/contacts. */
export const contactListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  q: z.string().trim().max(100).optional(),
  reviewStatus: z.enum(REVIEW_STATUSES).optional(),
});
export type ContactListQuery = z.infer<typeof contactListQuerySchema>;

/** Body of PATCH /contacts/:id. Only the fields that are sent change; null or "" clears an optional field. */
export const updateContactSchema = z
  .object({
    displayName: z.string().trim().min(1).max(240),
    firstName: optionalText(120),
    lastName: optionalText(120),
    organization: optionalText(240),
    jobTitle: optionalText(180),
    department: optionalText(180),
    notes: optionalText(4000),
    reviewStatus: z.enum(REVIEW_STATUSES),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field.');
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

export class UpdateContactDto {
  @ApiProperty({ required: false, example: 'Arun Kumar' })
  displayName?: string;
  @ApiProperty({ required: false, nullable: true })
  firstName?: string | null;
  @ApiProperty({ required: false, nullable: true })
  lastName?: string | null;
  @ApiProperty({ required: false, nullable: true, example: 'ABC Technologies' })
  organization?: string | null;
  @ApiProperty({ required: false, nullable: true, example: 'Software Developer' })
  jobTitle?: string | null;
  @ApiProperty({ required: false, nullable: true, example: 'Engineering' })
  department?: string | null;
  @ApiProperty({ required: false, nullable: true })
  notes?: string | null;
  @ApiProperty({ required: false, enum: REVIEW_STATUSES })
  reviewStatus?: string;
}

export class ContactMethodDto {
  @ApiProperty({ example: '5', description: 'BIGINT as a decimal string.' })
  id: string;
  @ApiProperty({ example: 'email', description: 'email | phone | website | social' })
  type: string;
  @ApiProperty({ type: String, nullable: true, example: 'mobile', description: 'mobile, work, linkedin, github, ...' })
  label: string | null;
  @ApiProperty({ example: 'arun@example.com' })
  value: string;
  @ApiProperty()
  isPrimary: boolean;
}

export class ContactAddressDto {
  @ApiProperty({ example: '3' })
  id: string;
  @ApiProperty({ type: String, nullable: true })
  line1: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Chennai' })
  city: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Tamil Nadu' })
  region: string | null;
  @ApiProperty({ type: String, nullable: true })
  postalCode: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'India' })
  country: string | null;
}

export class ContactLinkDto {
  @ApiProperty({ example: 'business_card_scan', description: 'master.entity_types.code of the linked record.' })
  entityType: string;
  @ApiProperty({ example: '12', description: 'BIGINT as a decimal string.' })
  entityId: string;
  @ApiProperty({ example: 'source' })
  relationship: string;
}

export class ContactSourceDto {
  @ApiProperty({ type: String, nullable: true, example: 'business_card' })
  type: string | null;
  @ApiProperty({ type: String, nullable: true, example: '12' })
  recordId: string | null;
}

export class ContactSummaryDto {
  @ApiProperty({ example: '1' })
  id: string;
  @ApiProperty({ example: 'Arun Kumar' })
  displayName: string;
  @ApiProperty({ type: String, nullable: true })
  organization: string | null;
  @ApiProperty({ type: String, nullable: true })
  jobTitle: string | null;
  @ApiProperty({ type: String, nullable: true })
  email: string | null;
  @ApiProperty({ type: String, nullable: true })
  phone: string | null;
  @ApiProperty({ example: 'unreviewed' })
  reviewStatus: string;
  @ApiProperty()
  createdAt: string;
}

export class ContactDto {
  @ApiProperty({ example: '1' })
  id: string;
  @ApiProperty()
  displayName: string;
  @ApiProperty({ type: String, nullable: true })
  firstName: string | null;
  @ApiProperty({ type: String, nullable: true })
  lastName: string | null;
  @ApiProperty({ type: String, nullable: true })
  organization: string | null;
  @ApiProperty({ type: String, nullable: true })
  jobTitle: string | null;
  @ApiProperty({ type: String, nullable: true })
  department: string | null;
  @ApiProperty({ type: String, nullable: true })
  notes: string | null;
  @ApiProperty({ example: 'unreviewed', description: 'unreviewed | reviewed | rejected' })
  reviewStatus: string;
  @ApiProperty({ type: ContactSourceDto })
  source: ContactSourceDto;
  @ApiProperty({ type: [ContactMethodDto] })
  methods: ContactMethodDto[];
  @ApiProperty({ type: [ContactAddressDto] })
  addresses: ContactAddressDto[];
  @ApiProperty({ type: [ContactLinkDto], description: 'Every record (of any module) this contact is linked to.' })
  links: ContactLinkDto[];
  @ApiProperty()
  createdAt: string;
  @ApiProperty({ type: String, nullable: true })
  updatedAt: string | null;
}

export class ContactPageDto {
  @ApiProperty({ type: [ContactSummaryDto] })
  items: ContactSummaryDto[];
  @ApiProperty({ example: 1 })
  page: number;
  @ApiProperty({ example: 25 })
  pageSize: number;
  @ApiProperty({ example: 1 })
  total: number;
}
