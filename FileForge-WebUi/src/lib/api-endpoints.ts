// Every route FileForge-Api actually implements, relative to its `/api/v1` prefix (added once, in api-client.ts).
// Add a module here only when its controller exists in FileForge-Api.

const enc = encodeURIComponent;
const oneDrive = (workspaceId: string) => `/workspaces/${enc(workspaceId)}/storage/onedrive`;
const businessCards = (workspaceId: string) => `/workspaces/${enc(workspaceId)}/business-cards`;
const contacts = (workspaceId: string) => `/workspaces/${enc(workspaceId)}/contacts`;

/** The file routes shared by `/central-storage` (own files) and `/admin/central-storage` (every user's files). */
const centralFiles = (base: string) => ({
  list: `${base}/files`,
  file: (id: string) => `${base}/files/${enc(id)}`,
  download: (id: string) => `${base}/files/${enc(id)}/download`,
  preview: (id: string) => `${base}/files/${enc(id)}/preview`,
  content: (id: string) => `${base}/files/${enc(id)}/content`,
  usage: `${base}/usage`,
});

export const API_ENDPOINTS = {
  health: {
    live: '/health/live',
  },

  auth: {
    /** Browser navigation (redirects to Microsoft), never an XHR call. */
    login: '/auth/microsoft/login',
    /** Called by Microsoft, never by the app. Listed for completeness. */
    callback: '/auth/microsoft/callback',
    me: '/auth/me',
    csrf: '/auth/csrf',
    logout: '/auth/logout',
  },

  workspaces: {
    list: '/workspaces',
  },

  /** Central storage: all users' files in the administrator's OneDrive. Independent of the personal File Manager below. */
  centralStorage: {
    capabilities: '/central-storage/capabilities',
    me: { ...centralFiles('/central-storage'), upload: '/central-storage/files/upload' },
    /** System administrators only (the API checks this on every request). */
    admin: {
      ...centralFiles('/admin/central-storage'),
      upload: (userId: string) => `/admin/central-storage/users/${enc(userId)}/files/upload`,
      resync: (id: string) => `/admin/central-storage/files/${enc(id)}/resync`,
      users: '/admin/central-storage/users',
      connection: '/admin/central-storage/connection',
      connect: '/admin/central-storage/connection/connect',
      verify: '/admin/central-storage/connection/verify',
      /** Interrupted uploads, replacements and deletes, and what is being done about them. */
      recovery: {
        summary: '/admin/central-storage/recovery/summary',
        items: '/admin/central-storage/recovery/items',
        item: (id: string) => `/admin/central-storage/recovery/items/${enc(id)}`,
        retry: (id: string) => `/admin/central-storage/recovery/items/${enc(id)}/retry`,
        dismiss: (id: string) => `/admin/central-storage/recovery/items/${enc(id)}/dismiss`,
      },
    },
  },

  /** Scanned business cards of a workspace (a user only ever sees their own). The photo is kept in central storage. */
  businessCards: {
    list: (workspaceId: string) => businessCards(workspaceId),
    scan: (workspaceId: string) => `${businessCards(workspaceId)}/scan`,
    card: (workspaceId: string, id: string) => `${businessCards(workspaceId)}/${enc(id)}`,
    image: (workspaceId: string, id: string) => `${businessCards(workspaceId)}/${enc(id)}/image`,
    approve: (workspaceId: string, id: string) => `${businessCards(workspaceId)}/${enc(id)}/approve`,
    reject: (workspaceId: string, id: string) => `${businessCards(workspaceId)}/${enc(id)}/reject`,
  },

  /** The centralized contacts of a workspace: the contacts of every module in one place. */
  contacts: {
    list: (workspaceId: string) => contacts(workspaceId),
    contact: (workspaceId: string, id: string) => `${contacts(workspaceId)}/${enc(id)}`,
  },

  storage: {
    /** `/workspaces/:workspaceId/storage/onedrive`. `path` is always relative to the FileForge folder. */
    oneDrive: {
      status: (workspaceId: string) => oneDrive(workspaceId),
      connect: (workspaceId: string) => `${oneDrive(workspaceId)}/connect`,
      items: (workspaceId: string) => `${oneDrive(workspaceId)}/items`,
      files: (workspaceId: string) => `${oneDrive(workspaceId)}/files`,
      fileContent: (workspaceId: string) => `${oneDrive(workspaceId)}/files/content`,
    },
  },
} as const;
