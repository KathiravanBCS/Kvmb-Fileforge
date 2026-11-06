import type { GraphRequestContext } from '../../microsoft/graph/graph.client';

/** Who is acting. Always built on the server from the session, never from anything the browser sends. */
export interface Actor {
  userId: bigint;
  /** True only on /admin/central-storage routes, after the system-admin check against the database. */
  isAdmin: boolean;
  /** For the audit trail. */
  requestId?: string;
  ip?: string;
}

/** The Microsoft account that becomes the central storage account. Matched on issuer + subject, never on e-mail. */
export interface ConnectedAccount {
  ownerUserId: bigint;
  issuer: string;
  subject: string;
  tenantId: string | null;
  accountType: 'personal' | 'organizational' | 'unknown';
  homeAccountId: string;
  email: string | null;
  displayName: string | null;
}

/** Ids of the central folders in the central drive. */
export interface CentralLayout {
  driveId: string;
  rootItemId: string;
  usersFolderItemId: string;
}

/** Everything a Graph call needs from the stored connection. Ids come from PostgreSQL, never from the browser. */
export interface UsableCentralConnection {
  id: bigint;
  driveId: string;
  rootItemId: string;
  usersFolderItemId: string;
  ownerUserId: bigint;
}

export interface CentralGraphContext {
  graph: GraphRequestContext;
  connection: UsableCentralConnection;
}

/** Quota as Graph reports it (bytes). */
export interface DriveQuota {
  total: number | null;
  used: number | null;
  remaining: number | null;
  state: string | null;
}

/** A file as returned to the browser: no OneDrive ids, no stored name, no links. */
export interface CentralFileView {
  id: string;
  name: string;
  extension: string | null;
  mimeType: string;
  size: number;
  status: string;
  contentVersion: number;
  previewable: boolean;
  ownerId: string;
  uploadedById: string;
  createdAt: string;
  uploadedAt: string | null;
  updatedAt: string | null;
  /** Administrator views only. */
  owner?: { id: string; displayName: string | null; email: string };
}

export interface CentralFilePage {
  items: CentralFileView[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CentralUsage {
  fileCount: number;
  totalBytes: number;
}

/** The file received from the browser: a temporary file on local disk (never held in memory). */
export interface IncomingFile {
  /** Path of the temporary file. The caller deletes it. */
  path: string;
  /** The name the browser sent: only ever used as the display name, after validation. */
  originalName: string;
  size: number;
}
