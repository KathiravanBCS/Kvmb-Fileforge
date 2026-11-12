/** The app's storage root inside the user's OneDrive: nothing outside this folder is ever read or written. */
export const ROOT_FOLDER_NAME = 'FileForge';

export const ONEDRIVE_PROVIDER_CODE = 'onedrive';

/** Delegated Graph permission requested by the Connect OneDrive flow (incremental consent; sign-in does not ask for it). */
export const FILES_SCOPE = 'Files.ReadWrite';
export const CONNECT_SCOPES = ['openid', 'profile', 'email', 'offline_access', FILES_SCOPE];

/**
 * Simple (single request) uploads are buffered in memory, so the app caps them well below what Graph accepts.
 * Larger files need upload sessions (a later increment).
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Most children returned for one folder; beyond this the response is flagged `truncated`. */
export const MAX_LIST_ITEMS = 1000;
export const LIST_PAGE_SIZE = 200;

/** Workspace role codes (roles). Operations are allowed by role code per workspace; there is no global role. */
export const READ_ROLES = ['owner', 'admin', 'editor', 'viewer'];
export const WRITE_ROLES = ['owner', 'admin', 'editor'];
export const MANAGE_ROLES = ['owner', 'admin'];

/** Module folders under the root, and the `folder_mappings.module_code` each one is registered under. */
export const MODULE_FOLDERS: readonly { folderName: string; moduleCode: string }[] = [
  { folderName: 'business-cards', moduleCode: 'business_card' },
  { folderName: 'email-attachments', moduleCode: 'email_attachments' },
  { folderName: 'exports', moduleCode: 'export' },
  { folderName: 'invoices', moduleCode: 'invoice' },
  { folderName: 'pdf-documents', moduleCode: 'pdf' },
  { folderName: 'qr-scans', moduleCode: 'qr' },
  { folderName: 'receipts', moduleCode: 'receipt' },
  { folderName: 'reports', moduleCode: 'reports' },
];
