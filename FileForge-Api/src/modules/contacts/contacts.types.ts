/** Kinds of contact method. Matches the contact_methods.method_type CHECK constraint. */
export type ContactMethodType = 'email' | 'phone' | 'website' | 'social';

export interface ContactMethodInput {
  type: ContactMethodType;
  /** What it is: mobile, work, linkedin, github, ... */
  label: string | null;
  /** E-mail values must already be lowercase. */
  value: string;
}

export interface ContactAddressInput {
  line1: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
}

/** A person, as any module hands it over to be saved as a contact. */
export interface ContactPerson {
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  organization: string | null;
  jobTitle: string | null;
  department: string | null;
  methods: ContactMethodInput[];
  address: ContactAddressInput | null;
}

export interface SaveFromSourceInput {
  workspaceId: bigint;
  userId: bigint;
  /** master.entity_types.code of the record the contact comes from, e.g. 'business_card_scan'. */
  entityTypeCode: string;
  /** Id of that record. */
  entityId: bigint;
  /** master.contact_source_types.code, e.g. 'business_card'. */
  sourceTypeCode: string;
  person: ContactPerson;
}

export interface ContactMethodView {
  id: string;
  type: string;
  label: string | null;
  value: string;
  isPrimary: boolean;
}

export interface ContactAddressView {
  id: string;
  line1: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface ContactLinkView {
  /** master.entity_types.code */
  entityType: string;
  /** BIGINT as a decimal string. */
  entityId: string;
  relationship: string;
}

export interface ContactSummary {
  id: string;
  displayName: string;
  organization: string | null;
  jobTitle: string | null;
  /** The primary e-mail address, or the first one. */
  email: string | null;
  /** The primary phone number, or the first one. */
  phone: string | null;
  reviewStatus: string;
  createdAt: string;
}

export interface ContactView {
  id: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  organization: string | null;
  jobTitle: string | null;
  department: string | null;
  notes: string | null;
  reviewStatus: string;
  /** Where it first came from: master.contact_source_types.code and the id of that record. */
  source: { type: string | null; recordId: string | null };
  methods: ContactMethodView[];
  addresses: ContactAddressView[];
  /** Every record (of any module) this contact is linked to. */
  links: ContactLinkView[];
  createdAt: string;
  updatedAt: string | null;
}

export interface ContactPage {
  items: ContactSummary[];
  page: number;
  pageSize: number;
  total: number;
}
