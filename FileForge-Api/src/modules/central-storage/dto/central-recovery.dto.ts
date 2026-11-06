import { z } from 'zod';

import { ApiProperty } from '@nestjs/swagger';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../central-storage.constants';

export const RECOVERY_STATES = ['all', 'needs_review', 'retrying', 'waiting'] as const;

export const recoveryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  state: z.enum(RECOVERY_STATES).default('all'),
});
export type RecoveryListQuery = z.infer<typeof recoveryListQuerySchema>;

export class RecoveryWorkerDto {
  @ApiProperty({
    description: 'False = no automatic recovery runs; files can still be recovered by hand from this page.',
  })
  enabled: boolean;
  @ApiProperty()
  intervalSeconds: number;
  @ApiProperty({ description: 'A file is only picked up after being untouched this long.' })
  staleMinutes: number;
  @ApiProperty()
  maxAttempts: number;
}

export class RecoverySummaryDto {
  @ApiProperty({ type: RecoveryWorkerDto })
  worker: RecoveryWorkerDto;
  @ApiProperty({ description: 'Parked for an administrator: the worker will not touch them.' })
  needsReview: number;
  @ApiProperty({ description: 'Tried before and scheduled to be tried again.' })
  retrying: number;
  @ApiProperty({ description: 'Interrupted, not examined yet.' })
  waiting: number;
  @ApiProperty({ description: 'Waiting for the central OneDrive to be reconnected.' })
  reauthRequired: number;
  @ApiProperty({ description: 'Files repaired automatically or by hand in the last 24 hours.' })
  repairedLast24h: number;
  @ApiProperty({ type: String, nullable: true })
  lastRecoveryAt: string | null;
}

export class RecoveryOwnerDto {
  @ApiProperty()
  id: string;
  @ApiProperty({ type: String, nullable: true })
  displayName: string | null;
  @ApiProperty()
  email: string;
}

export class RecoveryItemDto {
  @ApiProperty({ example: '12', description: 'BIGINT as a decimal string.' })
  id: string;
  @ApiProperty()
  fileName: string;
  @ApiProperty({ type: String, nullable: true })
  extension: string | null;
  @ApiProperty()
  ownerId: string;
  @ApiProperty({ type: RecoveryOwnerDto, nullable: true })
  owner: RecoveryOwnerDto | null;
  @ApiProperty({ example: 'uploading' })
  status: string;
  @ApiProperty({ enum: ['needs_review', 'retrying', 'waiting'] })
  state: string;
  @ApiProperty({ description: 'Bytes.' })
  sizeBytes: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Size of a replacement that was in progress.' })
  pendingSizeBytes: number | null;
  @ApiProperty()
  createdAt: string;
  @ApiProperty({ type: String, nullable: true })
  updatedAt: string | null;
  @ApiProperty()
  attempts: number;
  @ApiProperty()
  maxAttempts: number;
  @ApiProperty({ type: String, nullable: true })
  nextRecoveryAt: string | null;
  @ApiProperty({ type: String, nullable: true })
  lastRecoveryAt: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'repaired' })
  lastOutcome: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'orphan_onedrive_item' })
  reviewReason: string | null;
  @ApiProperty({ type: String, nullable: true })
  lastErrorCode: string | null;
  @ApiProperty({ description: 'Plain-language account of what happened and what happens next.' })
  explanation: string;
  @ApiProperty({ description: 'A worker (or an administrator) is working on this file right now.' })
  inProgress: boolean;
}

export class RecoveryPageDto {
  @ApiProperty({ type: [RecoveryItemDto] })
  items: RecoveryItemDto[];
  @ApiProperty()
  page: number;
  @ApiProperty()
  pageSize: number;
  @ApiProperty()
  total: number;
}

export class RecoveryEventDto {
  @ApiProperty({ example: 'central_storage.recovery.repaired' })
  action: string;
  @ApiProperty({ example: 'system' })
  actorType: string;
  @ApiProperty()
  occurredAt: string;
  @ApiProperty({ description: 'Ids, statuses and codes only.' })
  details: Record<string, unknown>;
}

export class RecoveryDetailDto {
  @ApiProperty({ type: RecoveryItemDto })
  item: RecoveryItemDto;
  @ApiProperty({ type: [RecoveryEventDto] })
  events: RecoveryEventDto[];
}

export class RecoveryActionResultDto {
  @ApiProperty({ enum: ['repaired', 'retry_scheduled', 'needs_review', 'reauth_required', 'no_action', 'lease_lost'] })
  outcome: string;
  @ApiProperty({ type: RecoveryItemDto })
  item: RecoveryItemDto;
}
