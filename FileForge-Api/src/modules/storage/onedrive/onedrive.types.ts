/** The parts of a Microsoft Graph `driveItem` that this module reads. */
export interface GraphDriveItem {
  id: string;
  name: string;
  size?: number;
  eTag?: string;
  cTag?: string;
  webUrl?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  /** Present on shortcuts to items in another drive: never followed. */
  remoteItem?: unknown;
  /** Present on OneNote notebooks and similar: not listed. */
  package?: unknown;
  parentReference?: { driveId?: string; id?: string; path?: string };
}

export interface GraphChildrenPage {
  value: GraphDriveItem[];
  '@odata.nextLink'?: string;
}

/** An item as returned to the browser. No Graph ids, no drive ids, no links: only what the UI needs. */
export interface OneDriveItem {
  name: string;
  type: 'file' | 'folder';
  size: number;
  mimeType: string | null;
  modifiedAt: string | null;
  /** Path relative to the FileForge root, e.g. `invoices/a.pdf`. This is what the browser sends back. */
  path: string;
}

export interface OneDriveListing {
  /** The folder that was listed, relative to the FileForge root (`''` is the root). */
  path: string;
  items: OneDriveItem[];
  /** True when the folder has more items than the 1000 returned. */
  truncated: boolean;
}

export type OneDriveStatusCode =
  'not_connected' | 'connected' | 'consent_required' | 'reauth_required' | 'owned_by_other_user' | 'error';

export interface ConnectionSummary {
  /** BIGINT as a decimal string. */
  id: string;
  name: string;
  rootFolderPath: string | null;
  lastAuthAt: string | null;
  lastVerifiedAt: string | null;
}

export interface OneDriveStatus {
  status: OneDriveStatusCode;
  connection: ConnectionSummary | null;
}

/** A stored connection that is safe to use: its drive and root ids are what every Graph path is built from. */
export interface UsableConnection {
  id: bigint;
  workspaceId: bigint;
  driveId: string;
  rootItemId: string;
}
