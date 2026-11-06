import { z } from 'zod';

// Contracts of FileForge-Api's central storage endpoints (/central-storage/* for the signed-in user,
// /admin/central-storage/* for system administrators). The browser never sees OneDrive ids, stored names or tokens:
// a file is identified by its database id (a BIGINT, so a decimal string).

export const CENTRAL_FILE_SORT_FIELDS = ['name', 'size', 'type', 'date'] as const;
export type CentralFileSortField = (typeof CENTRAL_FILE_SORT_FIELDS)[number];

export const CENTRAL_FILE_TYPES = ['image', 'pdf', 'document', 'spreadsheet', 'presentation', 'text', 'archive', 'other'] as const;
export type CentralFileType = (typeof CENTRAL_FILE_TYPES)[number];

export const centralFileOwnerSchema = z.object({
  id: z.string(),
  displayName: z.string().nullable(),
  email: z.string(),
});

export const centralFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  extension: z.string().nullable(),
  mimeType: z.string(),
  size: z.number(),
  status: z.string(),
  contentVersion: z.number(),
  previewable: z.boolean(),
  ownerId: z.string(),
  uploadedById: z.string(),
  createdAt: z.string(),
  uploadedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  /** Only in administrator views. */
  owner: centralFileOwnerSchema.optional(),
});

export const centralFilePageSchema = z.object({
  items: z.array(centralFileSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});

export const centralUsageSchema = z.object({ fileCount: z.number(), totalBytes: z.number() });

export const capabilitiesSchema = z.object({
  isSystemAdmin: z.boolean(),
  /** Central storage is connected and usable right now. */
  available: z.boolean(),
  maxFileBytes: z.number(),
});

export const adminUserUsageSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  fileCount: z.number(),
  totalBytes: z.number(),
});

export const adminUsageSchema = z.object({
  total: centralUsageSchema,
  perUser: z.array(adminUserUsageSchema),
});

const quotaSchema = z.object({
  total: z.number().nullable(),
  used: z.number().nullable(),
  remaining: z.number().nullable(),
  state: z.string().nullable(),
});

export const CONNECTION_STATUSES = ['not_connected', 'unverified', 'connected', 'reauth_required', 'revoked', 'error'] as const;

/** What the administrator page may show about the central OneDrive: never a token, an id or the encrypted cache. */
export const connectionStatusSchema = z.object({
  status: z.enum(CONNECTION_STATUSES),
  usable: z.boolean(),
  rootFolderPath: z.string().nullable(),
  account: z
    .object({ displayName: z.string().nullable(), email: z.string().nullable(), accountType: z.string() })
    .nullable(),
  lastAuthAt: z.string().nullable(),
  lastVerifiedAt: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  quota: quotaSchema.nullable(),
});

export const connectUrlSchema = z.object({ url: z.string() });

// ---- Recovery of interrupted operations (administrators only) ----------------------------------------------------------
// The API never sends OneDrive ids, stored names, eTags or checksums here either: a file is its database id.

export const RECOVERY_STATES = ['all', 'needs_review', 'retrying', 'waiting'] as const;
export type RecoveryState = (typeof RECOVERY_STATES)[number];

export const recoverySummarySchema = z.object({
  worker: z.object({
    enabled: z.boolean(),
    intervalSeconds: z.number(),
    staleMinutes: z.number(),
    maxAttempts: z.number(),
  }),
  needsReview: z.number(),
  retrying: z.number(),
  waiting: z.number(),
  reauthRequired: z.number(),
  repairedLast24h: z.number(),
  lastRecoveryAt: z.string().nullable(),
});

export const recoveryItemSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  extension: z.string().nullable(),
  ownerId: z.string(),
  owner: centralFileOwnerSchema.nullable(),
  status: z.string(),
  state: z.enum(['needs_review', 'retrying', 'waiting']),
  sizeBytes: z.number(),
  pendingSizeBytes: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
  attempts: z.number(),
  maxAttempts: z.number(),
  nextRecoveryAt: z.string().nullable(),
  lastRecoveryAt: z.string().nullable(),
  lastOutcome: z.string().nullable(),
  reviewReason: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  explanation: z.string(),
  inProgress: z.boolean(),
});

export const recoveryPageSchema = z.object({
  items: z.array(recoveryItemSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});

export const recoveryEventSchema = z.object({
  action: z.string(),
  actorType: z.string(),
  occurredAt: z.string(),
  details: z.record(z.string(), z.unknown()),
});

export const recoveryDetailSchema = z.object({ item: recoveryItemSchema, events: z.array(recoveryEventSchema) });

export const recoveryActionSchema = z.object({ outcome: z.string(), item: recoveryItemSchema });

export type CentralFile = z.infer<typeof centralFileSchema>;
export type CentralFilePage = z.infer<typeof centralFilePageSchema>;
export type CentralUsage = z.infer<typeof centralUsageSchema>;
export type Capabilities = z.infer<typeof capabilitiesSchema>;
export type AdminUserUsage = z.infer<typeof adminUserUsageSchema>;
export type AdminUsage = z.infer<typeof adminUsageSchema>;
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;
export type RecoverySummary = z.infer<typeof recoverySummarySchema>;
export type RecoveryItem = z.infer<typeof recoveryItemSchema>;
export type RecoveryPage = z.infer<typeof recoveryPageSchema>;
export type RecoveryEvent = z.infer<typeof recoveryEventSchema>;
export type RecoveryDetail = z.infer<typeof recoveryDetailSchema>;
export type RecoveryActionResult = z.infer<typeof recoveryActionSchema>;

/** Which API a screen talks to: the signed-in user's own files, or (administrators) everyone's. */
export type CentralScope = 'me' | 'admin';

/** Query of the "My Files" list. There is deliberately no owner here: the server only ever returns the user's own files. */
export interface CentralFilesQuery {
  page: number;
  pageSize: number;
  search?: string;
  type?: CentralFileType;
  sort: CentralFileSortField;
  order: 'asc' | 'desc';
}

/** Administrator list: the same plus an optional owner filter. */
export interface AdminFilesQuery extends CentralFilesQuery {
  ownerUserId?: string;
}
