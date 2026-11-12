import type { Contact } from './types';

/**
 * How a linked record (master.entity_types.code) is named and where it can be opened. A module that starts linking its records
 * to contacts adds one line here; an unknown type is still listed, by its code, without a link.
 */
const ENTITY_LINKS: Record<string, { label: string; href: (entityId: string) => string }> = {
  business_card_scan: { label: 'Business card', href: (id) => `/business-cards?open=${encodeURIComponent(id)}` },
};

export function describeLink(link: Contact['links'][number]): { label: string; href: string | null } {
  const known = ENTITY_LINKS[link.entityType];
  return known
    ? { label: `${known.label} #${link.entityId}`, href: known.href(link.entityId) }
    : { label: `${link.entityType.replace(/_/g, ' ')} #${link.entityId}`, href: null };
}

/** Only a real http(s) address becomes a clickable link: a stored value is data, never trusted as a URL scheme. */
export function isWebUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function formatAddress(address: Contact['addresses'][number]): string {
  return [address.line1, address.city, address.region, address.postalCode, address.country]
    .filter((part): part is string => Boolean(part))
    .join(', ');
}

export const REVIEW_LABELS: Record<string, { label: string; color: string }> = {
  unreviewed: { label: 'Not reviewed', color: 'yellow' },
  reviewed: { label: 'Reviewed', color: 'green' },
  rejected: { label: 'Rejected', color: 'gray' },
};

/** The API's own messages are written for people; only an unreachable server needs its own wording. */
export function contactErrorMessage(error: unknown): string {
  if (error instanceof Error && 'isNetworkError' in error && (error as { isNetworkError: boolean }).isNetworkError) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
