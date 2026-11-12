// One place for TanStack Query keys, so a mutation can invalidate exactly what it changed.
// Anything workspace-scoped carries the workspace id, so one workspace's data is never served for another.

export const queryKeys = {
  auth: {
    me: ['auth', 'me'] as const,
  },
  workspaces: {
    list: ['workspaces'] as const,
  },
  /** Central storage. The signed-in user's id is part of every key, so one user's data is never served to another. */
  centralStorage: {
    all: (userId: string) => ['central-storage', userId] as const,
    capabilities: (userId: string) => ['central-storage', userId, 'capabilities'] as const,
    /** Every files list of a scope, whatever its filters (for invalidation). */
    filesAll: (userId: string, scope: 'me' | 'admin') => ['central-storage', userId, scope, 'files'] as const,
    files: (userId: string, scope: 'me' | 'admin', query: object) => ['central-storage', userId, scope, 'files', query] as const,
    usage: (userId: string, scope: 'me' | 'admin') => ['central-storage', userId, scope, 'usage'] as const,
    preview: (userId: string, scope: 'me' | 'admin', fileId: string) =>
      ['central-storage', userId, scope, 'preview', fileId] as const,
    adminUsers: (userId: string, search: string) => ['central-storage', userId, 'admin', 'users', search] as const,
    connection: (userId: string) => ['central-storage', userId, 'admin', 'connection'] as const,
    /** Everything about recovery (for invalidation after a retry / review). */
    recoveryAll: (userId: string) => ['central-storage', userId, 'admin', 'recovery'] as const,
    recoverySummary: (userId: string) => ['central-storage', userId, 'admin', 'recovery', 'summary'] as const,
    recoveryItems: (userId: string, state: string) => ['central-storage', userId, 'admin', 'recovery', 'items', state] as const,
    recoveryItem: (userId: string, id: string) => ['central-storage', userId, 'admin', 'recovery', 'item', id] as const,
  },
  /** Business cards are private to their owner and contacts to a workspace: both keys carry the user and the workspace. */
  businessCards: {
    all: (userId: string, workspaceId: string) => ['business-cards', userId, workspaceId] as const,
    list: (userId: string, workspaceId: string, query: object) => ['business-cards', userId, workspaceId, 'list', query] as const,
    card: (userId: string, workspaceId: string, id: string) => ['business-cards', userId, workspaceId, 'card', id] as const,
    image: (userId: string, workspaceId: string, id: string, side: 'front' | 'back') =>
      ['business-cards', userId, workspaceId, 'image', id, side] as const,
  },
  contacts: {
    all: (userId: string, workspaceId: string) => ['contacts', userId, workspaceId] as const,
    list: (userId: string, workspaceId: string, query: object) => ['contacts', userId, workspaceId, 'list', query] as const,
    contact: (userId: string, workspaceId: string, id: string) => ['contacts', userId, workspaceId, 'contact', id] as const,
  },
  oneDrive: {
    /** Everything cached for one workspace's OneDrive. */
    all: (workspaceId: string) => ['onedrive', workspaceId] as const,
    status: (workspaceId: string) => ['onedrive', workspaceId, 'status'] as const,
    items: (workspaceId: string, path: string) => ['onedrive', workspaceId, 'items', path] as const,
  },
};
