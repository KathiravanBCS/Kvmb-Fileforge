import type {
  AdminUserUsage,
  Capabilities,
  CentralFile,
  ConnectionStatus,
  RecoveryItem,
  RecoverySummary,
} from '@/features/central-storage/types';

export function file(overrides: Partial<CentralFile> = {}): CentralFile {
  return {
    id: '10',
    name: 'invoice.pdf',
    extension: 'pdf',
    mimeType: 'application/pdf',
    size: 2048,
    status: 'ready',
    contentVersion: 1,
    previewable: true,
    ownerId: '2',
    uploadedById: '2',
    createdAt: '2026-11-05T10:00:00.000Z',
    uploadedAt: '2026-11-05T10:00:00.000Z',
    updatedAt: null,
    ...overrides,
  };
}

export const adminFile = (overrides: Partial<CentralFile> = {}) =>
  file({ id: '11', name: 'bob-report.pdf', ownerId: '3', uploadedById: '3', owner: { id: '3', displayName: 'Bob', email: 'bob@example.com' }, ...overrides });

export const page = (items: CentralFile[], total = items.length) => ({ items, page: 1, pageSize: 25, total });

export const capabilities = (overrides: Partial<Capabilities> = {}): Capabilities => ({
  isSystemAdmin: false,
  available: true,
  maxFileBytes: 50 * 1024 * 1024,
  ...overrides,
});

export const users: AdminUserUsage[] = [
  { id: '1', email: 'admin@example.com', displayName: 'Admin', fileCount: 0, totalBytes: 0 },
  { id: '2', email: 'alice@example.com', displayName: 'Alice', fileCount: 1, totalBytes: 2048 },
  { id: '3', email: 'bob@example.com', displayName: 'Bob', fileCount: 1, totalBytes: 4096 },
];

export const connection = (overrides: Partial<ConnectionStatus> = {}): ConnectionStatus => ({
  status: 'connected',
  usable: true,
  rootFolderPath: 'FileForge-Central',
  account: { displayName: 'Admin', email: 'admin@example.com', accountType: 'personal' },
  lastAuthAt: '2026-11-05T09:00:00.000Z',
  lastVerifiedAt: '2026-11-05T09:30:00.000Z',
  lastErrorCode: null,
  quota: null,
  ...overrides,
});

export const notConnected = (): ConnectionStatus =>
  connection({ status: 'not_connected', usable: false, rootFolderPath: null, account: null, lastAuthAt: null, lastVerifiedAt: null });

export const recoverySummary = (overrides: Partial<RecoverySummary> = {}): RecoverySummary => ({
  worker: { enabled: true, intervalSeconds: 60, staleMinutes: 30, maxAttempts: 6 },
  needsReview: 1,
  retrying: 1,
  waiting: 1,
  reauthRequired: 0,
  repairedLast24h: 3,
  lastRecoveryAt: '2026-11-06T08:00:00.000Z',
  ...overrides,
});

export const recoveryItem = (overrides: Partial<RecoveryItem> = {}): RecoveryItem => ({
  id: '30',
  fileName: 'stuck-upload.pdf',
  extension: 'pdf',
  ownerId: '2',
  owner: { id: '2', displayName: 'Alice', email: 'alice@example.com' },
  status: 'uploading',
  state: 'waiting',
  sizeBytes: 2048,
  pendingSizeBytes: null,
  createdAt: '2026-11-06T05:00:00.000Z',
  updatedAt: '2026-11-06T05:00:00.000Z',
  attempts: 0,
  maxAttempts: 6,
  nextRecoveryAt: null,
  lastRecoveryAt: null,
  lastOutcome: null,
  reviewReason: null,
  lastErrorCode: null,
  explanation: 'An upload was interrupted. The worker will look in OneDrive for the file and finish or discard it.',
  inProgress: false,
  ...overrides,
});
