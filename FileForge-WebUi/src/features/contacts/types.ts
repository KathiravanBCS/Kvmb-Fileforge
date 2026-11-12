import { z } from 'zod';

// Contracts of FileForge-Api's contact endpoints (all under /workspaces/:workspaceId/contacts).

export const REVIEW_STATUSES = ['unreviewed', 'reviewed', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const contactSummarySchema = z.object({
  id: z.string().regex(/^\d+$/),
  displayName: z.string(),
  organization: z.string().nullable(),
  jobTitle: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  reviewStatus: z.string(),
  createdAt: z.string(),
});

export const contactSchema = z.object({
  id: z.string().regex(/^\d+$/),
  displayName: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  organization: z.string().nullable(),
  jobTitle: z.string().nullable(),
  department: z.string().nullable(),
  notes: z.string().nullable(),
  reviewStatus: z.string(),
  source: z.object({ type: z.string().nullable(), recordId: z.string().nullable() }),
  methods: z.array(
    z.object({ id: z.string(), type: z.string(), label: z.string().nullable(), value: z.string(), isPrimary: z.boolean() }),
  ),
  addresses: z.array(
    z.object({
      id: z.string(),
      line1: z.string().nullable(),
      city: z.string().nullable(),
      region: z.string().nullable(),
      postalCode: z.string().nullable(),
      country: z.string().nullable(),
    }),
  ),
  /** Every record (of any module) this contact is linked to: entity type code + entity id. */
  links: z.array(z.object({ entityType: z.string(), entityId: z.string(), relationship: z.string() })),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

export const contactPageSchema = z.object({
  items: z.array(contactSummarySchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});

export type ContactSummary = z.infer<typeof contactSummarySchema>;
export type Contact = z.infer<typeof contactSchema>;
export type ContactPage = z.infer<typeof contactPageSchema>;

export interface ContactsQuery {
  page: number;
  pageSize: number;
  q?: string;
  reviewStatus?: ReviewStatus;
}

/** The fields PATCH accepts. `null` clears an optional one. */
export interface ContactUpdate {
  displayName?: string;
  organization?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  notes?: string | null;
  reviewStatus?: ReviewStatus;
}
