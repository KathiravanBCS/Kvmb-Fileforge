import { z } from 'zod';

/**
 * The data read from a business card. This is the shape the user sees, edits and approves, and the shape the model is asked
 * for. Every value is null when the card does not show it. The model's answer is never trusted as it is: every field is
 * validated on its own, and a bad one becomes null instead of failing the scan (see `sanitizeExtraction`).
 */

const emptyToNull = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const text = (max: number) => z.preprocess(emptyToNull, z.string().max(max).nullable());

const email = z.preprocess((value) => {
  const v = emptyToNull(value);
  return typeof v === 'string' ? v.toLowerCase() : v;
}, z.email().max(320).nullable());

/** A phone number as printed on the card: at least 5 and at most 20 digits, only phone punctuation around them. */
const phone = z.preprocess(
  emptyToNull,
  z
    .string()
    .max(40)
    .regex(/^\+?[\d\s().\-/]+$/, 'not a phone number')
    .refine((value) => {
      const digits = value.replace(/\D/g, '').length;
      return digits >= 5 && digits <= 20;
    }, 'not a phone number')
    .nullable(),
);

/** An http(s) link. A bare domain ("example.com/x") is accepted and becomes https://example.com/x. */
const link = z.preprocess(
  (value) => {
    const v = emptyToNull(value);
    if (typeof v !== 'string') return v;
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : /^[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(v) ? `https://${v}` : v;
  },
  z
    .url({ protocol: /^https?$/ })
    .max(500)
    .nullable(),
);

const addressFields = {
  line1: text(300),
  city: text(120),
  state: text(120),
  postalCode: text(30),
  country: text(120),
};
const socialFields = { linkedin: link, github: link };

export const businessCardDataSchema = z.object({
  fullName: text(240),
  jobTitle: text(180),
  companyName: text(240),
  department: text(180),
  email,
  mobile: phone,
  website: link,
  address: z.object(addressFields),
  socialLinks: z.object(socialFields),
});
export type BusinessCardData = z.infer<typeof businessCardDataSchema>;

/** Body of an edit: any subset of the fields (also inside address and socialLinks). Unsent fields stay as they are. */
export const businessCardPatchSchema = z
  .object({
    fullName: text(240),
    jobTitle: text(180),
    companyName: text(240),
    department: text(180),
    email,
    mobile: phone,
    website: link,
    address: z.object(addressFields).partial(),
    socialLinks: z.object(socialFields).partial(),
  })
  .partial();
export type BusinessCardPatch = z.infer<typeof businessCardPatchSchema>;

export function emptyBusinessCardData(): BusinessCardData {
  return {
    fullName: null,
    jobTitle: null,
    companyName: null,
    department: null,
    email: null,
    mobile: null,
    website: null,
    address: { line1: null, city: null, state: null, postalCode: null, country: null },
    socialLinks: { linkedin: null, github: null },
  };
}

/** Applies an edit on top of the current data. Nested objects are merged, so editing the city keeps the country. */
export function applyPatch(current: BusinessCardData, patch: BusinessCardPatch): BusinessCardData {
  return {
    ...current,
    ...stripUndefined({ ...patch, address: undefined, socialLinks: undefined }),
    address: { ...current.address, ...stripUndefined(patch.address ?? {}) },
    socialLinks: { ...current.socialLinks, ...stripUndefined(patch.socialLinks ?? {}) },
  };
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function fieldValue<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Turns whatever the model returned into valid card data. Unknown keys are dropped, wrong types and invalid values (a made-up
 * e-mail, a phone number without digits, a "website" that is not a link) become null. Never throws.
 */
export function sanitizeExtraction(raw: unknown): BusinessCardData {
  const source = isRecord(raw) ? raw : {};
  const address = isRecord(source['address']) ? source['address'] : {};
  const social = isRecord(source['socialLinks']) ? source['socialLinks'] : {};
  return {
    fullName: fieldValue(text(240), source['fullName']),
    jobTitle: fieldValue(text(180), source['jobTitle']),
    companyName: fieldValue(text(240), source['companyName']),
    department: fieldValue(text(180), source['department']),
    email: fieldValue(email, source['email']),
    mobile: fieldValue(phone, source['mobile']),
    website: fieldValue(link, source['website']),
    address: {
      line1: fieldValue(addressFields.line1, address['line1']),
      city: fieldValue(addressFields.city, address['city']),
      state: fieldValue(addressFields.state, address['state']),
      postalCode: fieldValue(addressFields.postalCode, address['postalCode']),
      country: fieldValue(addressFields.country, address['country']),
    },
    socialLinks: {
      linkedin: fieldValue(link, social['linkedin']),
      github: fieldValue(link, social['github']),
    },
  };
}

/** True when the card yielded nothing a contact could be made from. */
export function hasContactInformation(data: BusinessCardData): boolean {
  return Boolean(data.fullName || data.companyName || data.email || data.mobile);
}
