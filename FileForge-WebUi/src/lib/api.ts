import { z } from 'zod';

import { authUserSchema } from '@/features/auth/types';
import {
  adminUsageSchema,
  adminUserUsageSchema,
  capabilitiesSchema,
  centralFilePageSchema,
  centralFileSchema,
  centralUsageSchema,
  connectionStatusSchema,
  connectUrlSchema as centralConnectUrlSchema,
  recoveryActionSchema,
  recoveryDetailSchema,
  recoveryPageSchema,
  recoverySummarySchema,
  type RecoveryState,
  type AdminFilesQuery,
  type CentralFilesQuery,
} from '@/features/central-storage/types';
import { businessCardPageSchema, businessCardSchema, type BusinessCardsQuery, type CardPatch } from '@/features/business-cards/types';
import { contactPageSchema, contactSchema, type ContactsQuery, type ContactUpdate } from '@/features/contacts/types';
import {
  connectUrlSchema,
  oneDriveItemSchema,
  oneDriveListingSchema,
  oneDriveStatusSchema,
} from '@/features/file-manager/types';
import { workspaceSchema } from '@/features/workspaces/types';
import { API_URL, apiClient } from './api-client';
import { API_ENDPOINTS } from './api-endpoints';
import { ApiError, type RequestOptions, type UploadOptions } from './api-types';

// The typed service layer: endpoint (api-endpoints.ts) + HTTP method (api-client.ts) + the response contract.
// Pages and components never build URLs; they go through TanStack Query hooks, and those call this.
// The feature `types.ts` files imported above are leaf modules (zod schemas only), so there is no import cycle.

/** Responses are checked against their schema, so a backend change fails loudly here instead of deep in a component. */
function parse<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ApiError(`The server returned an unexpected response for ${what}.`, { status: 200 });
  return parsed.data;
}

const healthSchema = z.object({ status: z.string() });

/** Only a Microsoft sign-in origin is ever navigated to. */
const MICROSOFT_LOGIN_ORIGIN = 'https://login.microsoftonline.com';

type CentralRoutes = typeof API_ENDPOINTS.centralStorage.me | typeof API_ENDPOINTS.centralStorage.admin;

/** Only the fields the API understands go on the wire (and `ownerUserId` only if the query has it, i.e. the admin list). */
function listParams(query: CentralFilesQuery & { ownerUserId?: string }) {
  return {
    page: query.page,
    pageSize: query.pageSize,
    search: query.search,
    type: query.type,
    sort: query.sort,
    order: query.order,
    ownerUserId: query.ownerUserId,
  };
}

/**
 * The file operations both central-storage scopes share. `Query` is the only thing that differs: the own-files list has
 * no owner filter at all, so a "My Files" screen cannot ask for anyone else's files even by mistake.
 */
function centralFileOperations<Query extends CentralFilesQuery>(routes: CentralRoutes) {
  return {
    list: async (query: Query, options?: RequestOptions) =>
      parse(
        centralFilePageSchema,
        await apiClient.get<unknown>(routes.list, { ...options, params: listParams(query) }),
        'the file list',
      ),

    get: async (id: string, options?: RequestOptions) =>
      parse(centralFileSchema, await apiClient.get<unknown>(routes.file(id), options), 'the file'),

    rename: async (id: string, name: string, options?: RequestOptions) =>
      parse(centralFileSchema, await apiClient.patch<unknown>(routes.file(id), { name }, options), 'the rename'),

    remove: (id: string, options?: RequestOptions) => apiClient.delete<void>(routes.file(id), options),

    /** Replaces the CONTENT of an existing file (name and owner stay). */
    replaceContent: async (id: string, file: File, options?: UploadOptions) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return parse(
        centralFileSchema,
        await apiClient.upload<unknown>(routes.content(id), form, { ...options, method: 'put' }),
        'the replacement',
      );
    },

    /** The file bytes. Served as an attachment through the API: there is never a OneDrive link. */
    download: (id: string, options?: RequestOptions) => apiClient.download(routes.download(id), options),

    /** The bytes of a previewable file (image, PDF, plain text), to show in the page. */
    preview: (id: string, options?: RequestOptions) => apiClient.download(routes.preview(id), options),

    usage: async (options?: RequestOptions) =>
      parse(centralUsageSchema, await apiClient.get<unknown>(routes.usage, options), 'the storage usage'),
  };
}

function toFileForm(file: File): FormData {
  const form = new FormData();
  form.append('file', file, file.name);
  return form;
}

export const api = {
  health: {
    live: async (options?: RequestOptions) =>
      parse(healthSchema, await apiClient.get<unknown>(API_ENDPOINTS.health.live, options), 'the health check'),
  },

  auth: {
    /** Where to send the browser to sign in. A navigation, not an XHR call. */
    getLoginUrl: () => `${API_URL}${API_ENDPOINTS.auth.login}`,
    /** Throws an ApiError with status 401 when there is no session. */
    getMe: async (options?: RequestOptions) =>
      parse(authUserSchema, await apiClient.get<unknown>(API_ENDPOINTS.auth.me, options), 'the signed-in user'),
    logout: (options?: RequestOptions) => apiClient.post<void>(API_ENDPOINTS.auth.logout, undefined, options),
  },

  workspaces: {
    list: async (options?: RequestOptions) =>
      parse(z.array(workspaceSchema), await apiClient.get<unknown>(API_ENDPOINTS.workspaces.list, options), 'the workspaces'),
  },

  /** Scan business cards, review what was read, and approve it into the contacts. */
  businessCards: {
    list: async (workspaceId: string, query: BusinessCardsQuery, options?: RequestOptions) =>
      parse(
        businessCardPageSchema,
        await apiClient.get<unknown>(API_ENDPOINTS.businessCards.list(workspaceId), {
          ...options,
          params: { page: query.page, pageSize: query.pageSize, status: query.status },
        }),
        'the business cards',
      ),

    get: async (workspaceId: string, id: string, options?: RequestOptions) =>
      parse(businessCardSchema, await apiClient.get<unknown>(API_ENDPOINTS.businessCards.card(workspaceId, id), options), 'the business card'),

    /**
     * Uploads the photos of ONE card: the front, and the back when there is one. The API reads both together, stores them in
     * central storage and returns a PENDING scan.
     */
    scan: async (workspaceId: string, photos: { front: File; back?: File }, options?: UploadOptions) => {
      const form = new FormData();
      form.append('front', photos.front, photos.front.name);
      if (photos.back) form.append('back', photos.back, photos.back.name);
      return parse(
        businessCardSchema,
        await apiClient.upload<unknown>(API_ENDPOINTS.businessCards.scan(workspaceId), form, options),
        'the scan',
      );
    },

    update: async (workspaceId: string, id: string, patch: CardPatch, options?: RequestOptions) =>
      parse(
        businessCardSchema,
        await apiClient.patch<unknown>(API_ENDPOINTS.businessCards.card(workspaceId, id), patch, options),
        'the correction',
      ),

    approve: async (workspaceId: string, id: string, options?: RequestOptions) =>
      parse(
        businessCardSchema,
        await apiClient.post<unknown>(API_ENDPOINTS.businessCards.approve(workspaceId, id), undefined, options),
        'the approval',
      ),

    reject: async (workspaceId: string, id: string, options?: RequestOptions) =>
      parse(
        businessCardSchema,
        await apiClient.post<unknown>(API_ENDPOINTS.businessCards.reject(workspaceId, id), undefined, options),
        'the rejection',
      ),

    /** One side's photo bytes (private: served through the API from central storage). */
    image: (workspaceId: string, id: string, side: 'front' | 'back', options?: RequestOptions) =>
      apiClient.download(API_ENDPOINTS.businessCards.image(workspaceId, id), { ...options, params: { side } }),
  },

  contacts: {
    list: async (workspaceId: string, query: ContactsQuery, options?: RequestOptions) =>
      parse(
        contactPageSchema,
        await apiClient.get<unknown>(API_ENDPOINTS.contacts.list(workspaceId), {
          ...options,
          params: { page: query.page, pageSize: query.pageSize, q: query.q || undefined, reviewStatus: query.reviewStatus },
        }),
        'the contacts',
      ),

    get: async (workspaceId: string, id: string, options?: RequestOptions) =>
      parse(contactSchema, await apiClient.get<unknown>(API_ENDPOINTS.contacts.contact(workspaceId, id), options), 'the contact'),

    update: async (workspaceId: string, id: string, patch: ContactUpdate, options?: RequestOptions) =>
      parse(contactSchema, await apiClient.patch<unknown>(API_ENDPOINTS.contacts.contact(workspaceId, id), patch, options), 'the contact'),

    remove: (workspaceId: string, id: string, options?: RequestOptions) =>
      apiClient.delete<void>(API_ENDPOINTS.contacts.contact(workspaceId, id), options),
  },

  centralStorage: {
    /** What the signed-in user may do. The server decides `isSystemAdmin`; the UI only reflects it. */
    capabilities: async (options?: RequestOptions) =>
      parse(
        capabilitiesSchema,
        await apiClient.get<unknown>(API_ENDPOINTS.centralStorage.capabilities, options),
        'the storage capabilities',
      ),

    /** "My Files": every call acts as the signed-in user, on their own files only. */
    me: {
      ...centralFileOperations<CentralFilesQuery>(API_ENDPOINTS.centralStorage.me),
      upload: async (file: File, options?: UploadOptions) =>
        parse(
          centralFileSchema,
          await apiClient.upload<unknown>(API_ENDPOINTS.centralStorage.me.upload, toFileForm(file), options),
          'the upload',
        ),
    },

    /** Administrators only: the API answers 403 to anyone else. */
    admin: {
      ...centralFileOperations<AdminFilesQuery>(API_ENDPOINTS.centralStorage.admin),

      /** Uploads a file into another user's storage. The file belongs to `userId`; the audit trail names the administrator. */
      upload: async (userId: string, file: File, options?: UploadOptions) =>
        parse(
          centralFileSchema,
          await apiClient.upload<unknown>(API_ENDPOINTS.centralStorage.admin.upload(userId), toFileForm(file), options),
          'the upload',
        ),

      /** Re-reads a file from OneDrive and repairs its record (a replacement stored but not recorded). */
      resync: async (id: string, options?: RequestOptions) =>
        parse(
          centralFileSchema,
          await apiClient.post<unknown>(API_ENDPOINTS.centralStorage.admin.resync(id), undefined, options),
          'the resync',
        ),

      users: async (search: string, options?: RequestOptions) =>
        parse(
          z.array(adminUserUsageSchema),
          await apiClient.get<unknown>(API_ENDPOINTS.centralStorage.admin.users, {
            ...options,
            params: { search: search || undefined },
          }),
          'the users',
        ),

      totalUsage: async (options?: RequestOptions) =>
        parse(
          adminUsageSchema,
          await apiClient.get<unknown>(API_ENDPOINTS.centralStorage.admin.usage, options),
          'the storage usage',
        ),

      /** Interrupted operations: what needs attention, and the two things an administrator can do about it. */
      recovery: {
        summary: async (options?: RequestOptions) =>
          parse(
            recoverySummarySchema,
            await apiClient.get<unknown>(API_ENDPOINTS.centralStorage.admin.recovery.summary, options),
            'the recovery summary',
          ),

        list: async (state: RecoveryState, options?: RequestOptions) =>
          parse(
            recoveryPageSchema,
            await apiClient.get<unknown>(API_ENDPOINTS.centralStorage.admin.recovery.items, {
              ...options,
              // One page of the largest size: the queue is meant to be short, and the page says when it is not.
              params: { state, page: 1, pageSize: 100 },
            }),
            'the recovery list',
          ),

        detail: async (id: string, options?: RequestOptions) =>
          parse(
            recoveryDetailSchema,
            await apiClient.get<unknown>(API_ENDPOINTS.centralStorage.admin.recovery.item(id), options),
            'the recovery details',
          ),

        /** Runs the recovery checks for this file now. */
        retry: async (id: string, options?: RequestOptions) =>
          parse(
            recoveryActionSchema,
            await apiClient.post<unknown>(API_ENDPOINTS.centralStorage.admin.recovery.retry(id), undefined, options),
            'the recovery',
          ),

        /** "Reviewed, leave it as it is": takes the file out of the review queue. Changes nothing in OneDrive. */
        dismiss: async (id: string, options?: RequestOptions) =>
          parse(
            recoveryActionSchema,
            await apiClient.post<unknown>(API_ENDPOINTS.centralStorage.admin.recovery.dismiss(id), undefined, options),
            'the review',
          ),
      },

      connection: {
        get: async (options?: RequestOptions) =>
          parse(
            connectionStatusSchema,
            await apiClient.get<unknown>(API_ENDPOINTS.centralStorage.admin.connection, options),
            'the connection status',
          ),

        /** Runs a health check against OneDrive and returns the refreshed status (and quota). */
        verify: async (options?: RequestOptions) =>
          parse(
            connectionStatusSchema,
            await apiClient.post<unknown>(API_ENDPOINTS.centralStorage.admin.verify, undefined, options),
            'the connection check',
          ),

        /** The Microsoft consent URL to navigate to. The backend runs the OAuth flow; the browser holds no token. */
        connect: async (options?: RequestOptions) => {
          const { url } = parse(
            centralConnectUrlSchema,
            await apiClient.post<unknown>(API_ENDPOINTS.centralStorage.admin.connect, undefined, options),
            'the connect request',
          );
          if (new URL(url).origin !== MICROSOFT_LOGIN_ORIGIN) {
            throw new ApiError('The server returned an unexpected sign-in address.', { status: 200 });
          }
          return url;
        },
      },
    },
  },

  storage: {
    oneDrive: {
      getStatus: async (workspaceId: string, options?: RequestOptions) =>
        parse(
          oneDriveStatusSchema,
          await apiClient.get<unknown>(API_ENDPOINTS.storage.oneDrive.status(workspaceId), options),
          'the OneDrive status',
        ),

      listItems: async (workspaceId: string, path: string, options?: RequestOptions) =>
        parse(
          oneDriveListingSchema,
          await apiClient.get<unknown>(API_ENDPOINTS.storage.oneDrive.items(workspaceId), { ...options, params: { path } }),
          'the folder listing',
        ),

      /** The Microsoft consent URL to navigate to. */
      connect: async (workspaceId: string, options?: RequestOptions) => {
        const { url } = parse(
          connectUrlSchema,
          await apiClient.post<unknown>(API_ENDPOINTS.storage.oneDrive.connect(workspaceId), undefined, options),
          'the connect request',
        );
        if (new URL(url).origin !== MICROSOFT_LOGIN_ORIGIN) {
          throw new ApiError('The server returned an unexpected sign-in address.', { status: 200 });
        }
        return url;
      },

      upload: async (workspaceId: string, folderPath: string, file: File, options?: UploadOptions) => {
        const form = new FormData();
        form.append('path', folderPath);
        form.append('file', file, file.name);
        return parse(
          oneDriveItemSchema,
          await apiClient.upload<unknown>(API_ENDPOINTS.storage.oneDrive.files(workspaceId), form, options),
          'the upload',
        );
      },

      rename: async (workspaceId: string, path: string, newName: string, options?: RequestOptions) =>
        parse(
          oneDriveItemSchema,
          await apiClient.patch<unknown>(API_ENDPOINTS.storage.oneDrive.files(workspaceId), { path, newName }, options),
          'the rename',
        ),

      remove: (workspaceId: string, path: string, options?: RequestOptions) =>
        apiClient.delete<void>(API_ENDPOINTS.storage.oneDrive.files(workspaceId), { ...options, params: { path } }),

      /** The file bytes. The API always serves an attachment, so this is never rendered inline. */
      download: (workspaceId: string, path: string, options?: RequestOptions) =>
        apiClient.download(API_ENDPOINTS.storage.oneDrive.fileContent(workspaceId), { ...options, params: { path } }),
    },
  },
};
