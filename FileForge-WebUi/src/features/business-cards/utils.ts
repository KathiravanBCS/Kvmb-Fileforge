import { ApiError } from '@/lib/api-types';
import type { CardData, CardPatch, ScanStatus } from './types';

/** The form works with plain strings (an empty input is ""), the API with null. */
export interface CardDraft {
  fullName: string;
  jobTitle: string;
  companyName: string;
  department: string;
  email: string;
  mobile: string;
  website: string;
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  linkedin: string;
  github: string;
}

export type CardDraftKey = keyof CardDraft;

const s = (value: string | null) => value ?? '';

export function toDraft(data: CardData): CardDraft {
  return {
    fullName: s(data.fullName),
    jobTitle: s(data.jobTitle),
    companyName: s(data.companyName),
    department: s(data.department),
    email: s(data.email),
    mobile: s(data.mobile),
    website: s(data.website),
    line1: s(data.address.line1),
    city: s(data.address.city),
    state: s(data.address.state),
    postalCode: s(data.address.postalCode),
    country: s(data.address.country),
    linkedin: s(data.socialLinks.linkedin),
    github: s(data.socialLinks.github),
  };
}

const n = (value: string) => (value.trim() === '' ? null : value.trim());

/** Every field of the form, as the edit the API takes. An emptied input clears the field. */
export function toPatch(draft: CardDraft): CardPatch {
  return {
    fullName: n(draft.fullName),
    jobTitle: n(draft.jobTitle),
    companyName: n(draft.companyName),
    department: n(draft.department),
    email: n(draft.email)?.toLowerCase() ?? null,
    mobile: n(draft.mobile),
    website: n(draft.website),
    address: {
      line1: n(draft.line1),
      city: n(draft.city),
      state: n(draft.state),
      postalCode: n(draft.postalCode),
      country: n(draft.country),
    },
    socialLinks: { linkedin: n(draft.linkedin), github: n(draft.github) },
  };
}

/** True when the form differs from what is saved (ignoring surrounding spaces and e-mail case). */
export function isDirty(draft: CardDraft, saved: CardData): boolean {
  return JSON.stringify(toPatch(draft)) !== JSON.stringify(toPatch(toDraft(saved)));
}

const MAX: Partial<Record<CardDraftKey, number>> = {
  fullName: 240,
  jobTitle: 180,
  companyName: 240,
  department: 180,
  email: 320,
  mobile: 40,
  website: 500,
  line1: 300,
  city: 120,
  state: 120,
  postalCode: 30,
  country: 120,
  linkedin: 500,
  github: 500,
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARS = /^\+?[\d\s().\-/]+$/;
/** An http(s) link, or a bare domain (the API adds https://). */
const LINK = /^(https?:\/\/[^\s/$.?#][^\s]*|[\w-]+(\.[\w-]+)+(\/\S*)?)$/i;

/** The same rules the API applies, so a mistake is explained next to its field instead of as a refused request. */
export function validateDraft(draft: CardDraft): Partial<Record<CardDraftKey, string>> {
  const errors: Partial<Record<CardDraftKey, string>> = {};
  for (const key of Object.keys(draft) as CardDraftKey[]) {
    const value = draft[key].trim();
    if (value === '') continue;
    const max = MAX[key];
    if (max && value.length > max) errors[key] = `Use at most ${max} characters.`;
  }
  const email = draft.email.trim();
  if (email && !errors.email && !EMAIL.test(email)) errors.email = 'Enter a valid e-mail address.';

  const mobile = draft.mobile.trim();
  if (mobile && !errors.mobile) {
    const digits = mobile.replace(/\D/g, '').length;
    if (!PHONE_CHARS.test(mobile) || digits < 5 || digits > 20) errors.mobile = 'Enter a valid phone number.';
  }
  for (const key of ['website', 'linkedin', 'github'] as const) {
    const value = draft[key].trim();
    if (value && !errors[key] && !LINK.test(value)) errors[key] = 'Enter a web address, like https://example.com.';
  }
  return errors;
}

/** A card with nothing a contact can be made from: the API refuses to approve it. */
export function hasContactInformation(draft: CardDraft): boolean {
  return [draft.fullName, draft.companyName, draft.email, draft.mobile].some((value) => value.trim() !== '');
}

/** What to call a scan in a list: the person, else the company, else the e-mail, else the number. */
export function cardTitle(data: CardData): string {
  return data.fullName ?? data.companyName ?? data.email ?? data.mobile ?? 'Unreadable card';
}

export const STATUS_BADGE: Record<ScanStatus, { label: string; color: string }> = {
  pending: { label: 'To review', color: 'yellow' },
  approved: { label: 'Saved', color: 'green' },
  rejected: { label: 'Discarded', color: 'gray' },
};

/** The API's own message is already written for people; only an unreachable server needs its own wording. */
export function scanErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isNetworkError) return 'Could not reach the server. Check your connection and try again.';
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

/** Checks a chosen photo before it is uploaded. Returns why it is refused, or null. */
export function checkCardImage(file: File, maxBytes: number): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
    return 'Use a JPG, PNG or WebP photo of the card.';
  }
  if (file.size > maxBytes) return `The photo is too large. Use one up to ${Math.floor(maxBytes / (1024 * 1024))} MB.`;
  return null;
}
