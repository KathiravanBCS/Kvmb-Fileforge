import { describe, expect, it } from 'vitest';

import { cardData, emptyCardData } from '@/test/contactFixtures';
import { ApiError } from '@/lib/api-types';
import { cardTitle, checkCardImage, hasContactInformation, isDirty, scanErrorMessage, toDraft, toPatch, validateDraft } from './utils';

describe('toDraft / toPatch', () => {
  it('turns nulls into empty inputs and empty inputs back into null', () => {
    const draft = toDraft(emptyCardData());
    expect(Object.values(draft).every((value) => value === '')).toBe(true);
    expect(toPatch(draft)).toEqual({
      fullName: null,
      jobTitle: null,
      companyName: null,
      department: null,
      email: null,
      mobile: null,
      website: null,
      address: { line1: null, city: null, state: null, postalCode: null, country: null },
      socialLinks: { linkedin: null, github: null },
    });
  });

  it('trims spaces and lowercases the e-mail', () => {
    const patch = toPatch({ ...toDraft(cardData()), fullName: '  Arun  ', email: ' Arun@Example.COM ' });
    expect(patch.fullName).toBe('Arun');
    expect(patch.email).toBe('arun@example.com');
  });
});

describe('isDirty', () => {
  it('is false for an untouched form and for changes that only add spaces or change e-mail case', () => {
    const data = cardData();
    expect(isDirty(toDraft(data), data)).toBe(false);
    expect(isDirty({ ...toDraft(data), fullName: ' Arun Kumar ', email: 'ARUN@example.com' }, data)).toBe(false);
  });

  it('is true when a value really changed, including clearing one', () => {
    const data = cardData();
    expect(isDirty({ ...toDraft(data), city: 'Madurai' }, data)).toBe(true);
    expect(isDirty({ ...toDraft(data), department: '' }, data)).toBe(true);
  });
});

describe('validateDraft', () => {
  it('accepts a complete, valid card', () => {
    expect(validateDraft(toDraft(cardData({ socialLinks: { linkedin: 'https://linkedin.com/in/arun', github: 'github.com/arun' } })))).toEqual({});
  });

  it('accepts a card with nothing filled in (the "nothing to save" rule is separate)', () => {
    expect(validateDraft(toDraft(emptyCardData()))).toEqual({});
  });

  it.each([
    ['email', 'not-an-email'],
    ['email', 'a@b'],
    ['mobile', 'call me'],
    ['mobile', '12'],
    ['website', 'javascript:alert(1)'],
    ['website', 'not a link'],
    ['linkedin', 'ftp://x.example'],
  ] as const)('refuses %s = %j', (key, value) => {
    expect(validateDraft({ ...toDraft(cardData()), [key]: value })[key]).toBeTruthy();
  });

  it('refuses values over the length limit the API enforces', () => {
    expect(validateDraft({ ...toDraft(cardData()), fullName: 'x'.repeat(241) }).fullName).toMatch(/240/);
  });
});

describe('hasContactInformation / cardTitle', () => {
  it('needs a name, company, e-mail or phone number', () => {
    expect(hasContactInformation(toDraft(emptyCardData()))).toBe(false);
    expect(hasContactInformation({ ...toDraft(emptyCardData()), jobTitle: 'CEO' })).toBe(false);
    expect(hasContactInformation({ ...toDraft(emptyCardData()), email: 'a@b.co' })).toBe(true);
  });

  it('names a card after the person, then company, e-mail, number, else "Unreadable card"', () => {
    expect(cardTitle(cardData())).toBe('Arun Kumar');
    expect(cardTitle(cardData({ fullName: null }))).toBe('ABC Technologies');
    expect(cardTitle({ ...emptyCardData(), mobile: '+91 12345' })).toBe('+91 12345');
    expect(cardTitle(emptyCardData())).toBe('Unreadable card');
  });
});

describe('checkCardImage', () => {
  const MB = 1024 * 1024;
  it('accepts JPG, PNG and WebP up to the limit', () => {
    expect(checkCardImage(new File(['x'], 'card.jpg', { type: 'image/jpeg' }), 10 * MB)).toBeNull();
    expect(checkCardImage(new File(['x'], 'card.PNG', { type: '' }), 10 * MB)).toBeNull();
  });
  it('refuses other types and oversized photos, with a reason the user can act on', () => {
    expect(checkCardImage(new File(['x'], 'card.pdf', { type: 'application/pdf' }), 10 * MB)).toMatch(/JPG, PNG or WebP/);
    const big = new File(['x'], 'card.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 11 * MB });
    expect(checkCardImage(big, 10 * MB)).toMatch(/10 MB/);
  });
});

describe('scanErrorMessage', () => {
  it('uses the API message, a plain one for an unreachable server, and a fallback for anything else', () => {
    expect(scanErrorMessage(new ApiError('Too many cards were scanned in a short time.', { status: 429 }))).toBe('Too many cards were scanned in a short time.');
    expect(scanErrorMessage(new ApiError('x', { isNetworkError: true }))).toMatch(/reach the server/);
    expect(scanErrorMessage('boom')).toMatch(/try again/i);
  });
});
