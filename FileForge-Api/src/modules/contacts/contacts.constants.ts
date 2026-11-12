/** Workspace role codes that may read / change contacts. Same split as files: viewers read, editors and above write. */
export const CONTACT_READ_ROLES = ['owner', 'admin', 'editor', 'viewer'];
export const CONTACT_WRITE_ROLES = ['owner', 'admin', 'editor'];

/** Entity-type code (master.entity_types) of a scanned business card. */
export const ENTITY_BUSINESS_CARD_SCAN = 'business_card_scan';
/** Source-type code (master.contact_source_types) of a contact that came from a business card. */
export const CONTACT_SOURCE_BUSINESS_CARD = 'business_card';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
