import { z } from 'zod';

import { ApiProperty } from '@nestjs/swagger';

import { FILE_TYPE_FILTERS } from '../central-file-types';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../central-storage.constants';

/** Query of GET /central-storage/files. There is deliberately no owner filter: users only ever see their own files. */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  search: z.string().trim().max(100).optional(),
  type: z.enum(FILE_TYPE_FILTERS).optional(),
  sort: z.enum(['name', 'size', 'type', 'date']).default('date'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type ListQuery = z.infer<typeof listQuerySchema> & { ownerUserId?: string };

/** Administrator list: the same, plus an optional owner filter. */
export const adminListQuerySchema = listQuerySchema.extend({
  ownerUserId: z
    .string()
    .regex(/^\d{1,19}$/)
    .optional(),
});

export const renameFileSchema = z.object({ name: z.string().min(1).max(255) });

export const userSearchSchema = z.object({ search: z.string().trim().max(100).optional() });

export class RenameCentralFileDto {
  @ApiProperty({ example: 'final-invoice.pdf', description: 'New display name. The extension must stay the same.' })
  name: string;
}

export class CentralFileOwnerDto {
  @ApiProperty({ example: '2', description: 'BIGINT as a decimal string.' })
  id: string;
  @ApiProperty({ type: String, nullable: true })
  displayName: string | null;
  @ApiProperty()
  email: string;
}

export class CentralFileDto {
  @ApiProperty({ example: '12', description: 'BIGINT as a decimal string.' })
  id: string;
  @ApiProperty({ example: 'invoice.pdf' })
  name: string;
  @ApiProperty({ type: String, nullable: true, example: 'pdf' })
  extension: string | null;
  @ApiProperty({ example: 'application/pdf' })
  mimeType: string;
  @ApiProperty({ example: 20480, description: 'Bytes.' })
  size: number;
  @ApiProperty({ example: 'ready' })
  status: string;
  @ApiProperty({ example: 1 })
  contentVersion: number;
  @ApiProperty({ description: 'True when the file can be shown inline (images, PDF, plain text).' })
  previewable: boolean;
  @ApiProperty()
  ownerId: string;
  @ApiProperty()
  uploadedById: string;
  @ApiProperty()
  createdAt: string;
  @ApiProperty({ type: String, nullable: true })
  uploadedAt: string | null;
  @ApiProperty({ type: String, nullable: true })
  updatedAt: string | null;
  @ApiProperty({ type: CentralFileOwnerDto, required: false, description: 'Administrator views only.' })
  owner?: CentralFileOwnerDto;
}

export class CentralFilePageDto {
  @ApiProperty({ type: [CentralFileDto] })
  items: CentralFileDto[];
  @ApiProperty()
  page: number;
  @ApiProperty()
  pageSize: number;
  @ApiProperty()
  total: number;
}

export class CentralUsageDto {
  @ApiProperty()
  fileCount: number;
  @ApiProperty({ description: 'Bytes.' })
  totalBytes: number;
}

export class CentralCapabilitiesDto {
  @ApiProperty()
  isSystemAdmin: boolean;
  @ApiProperty({ description: 'True when central storage is connected and usable right now.' })
  available: boolean;
  @ApiProperty({ example: 52428800 })
  maxFileBytes: number;
}

export class AdminUserUsageDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  email: string;
  @ApiProperty({ type: String, nullable: true })
  displayName: string | null;
  @ApiProperty()
  fileCount: number;
  @ApiProperty()
  totalBytes: number;
}

export class AdminUsageDto {
  @ApiProperty({ type: CentralUsageDto })
  total: CentralUsageDto;
  @ApiProperty({ type: [AdminUserUsageDto] })
  perUser: AdminUserUsageDto[];
}

export class CentralConnectionStatusDto {
  @ApiProperty({ enum: ['not_connected', 'unverified', 'connected', 'reauth_required', 'revoked', 'error'] })
  status: string;
  @ApiProperty({ description: 'True when the status is "connected".' })
  usable: boolean;
  @ApiProperty({ type: String, nullable: true, example: 'FileForge-Central' })
  rootFolderPath: string | null;
  @ApiProperty({ description: 'The connected Microsoft account. Never any token.', nullable: true })
  account: { displayName: string | null; email: string | null; accountType: string } | null;
  @ApiProperty({ type: String, nullable: true })
  lastAuthAt: string | null;
  @ApiProperty({ type: String, nullable: true })
  lastVerifiedAt: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Short code of the last failure, e.g. reauth_required.' })
  lastErrorCode: string | null;
  @ApiProperty({ nullable: true })
  quota: { total: number | null; used: number | null; remaining: number | null; state: string | null } | null;
}

export class ConnectUrlDto {
  @ApiProperty({ description: 'Send the browser here to authorize the central OneDrive on Microsoft.' })
  url: string;
}
