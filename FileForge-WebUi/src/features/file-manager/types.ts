import { z } from 'zod';

// Contracts of FileForge-Api's OneDrive endpoints (all under /workspaces/:workspaceId/storage/onedrive).
// `path` is always relative to the FileForge folder. The browser never sees or sends OneDrive ids.

export const oneDriveItemSchema = z.object({
  name: z.string(),
  type: z.enum(['file', 'folder']),
  size: z.number(),
  mimeType: z.string().nullable(),
  modifiedAt: z.string().nullable(),
  path: z.string(),
});

export const oneDriveListingSchema = z.object({
  path: z.string(),
  items: z.array(oneDriveItemSchema),
  truncated: z.boolean(),
});

export const oneDriveStatusSchema = z.object({
  status: z.enum(['not_connected', 'connected', 'consent_required', 'reauth_required', 'owned_by_other_user', 'error']),
  connection: z
    .object({
      id: z.string(),
      name: z.string(),
      rootFolderPath: z.string().nullable(),
      lastAuthAt: z.string().nullable(),
      lastVerifiedAt: z.string().nullable(),
    })
    .nullable(),
});

export const connectUrlSchema = z.object({ url: z.string() });

export type OneDriveItem = z.infer<typeof oneDriveItemSchema>;
export type OneDriveListing = z.infer<typeof oneDriveListingSchema>;
export type OneDriveStatus = z.infer<typeof oneDriveStatusSchema>;
