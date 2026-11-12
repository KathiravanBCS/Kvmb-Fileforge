import {
  applyPatch,
  businessCardPatchSchema,
  emptyBusinessCardData,
  hasContactInformation,
  sanitizeExtraction,
} from './business-card.data';

const SAMPLE = {
  fullName: 'Arun Kumar',
  jobTitle: 'Software Developer',
  companyName: 'ABC Technologies',
  department: 'Engineering',
  email: 'arun@example.com',
  mobile: '+91 9876543210',
  website: 'https://example.com',
  address: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
  socialLinks: { linkedin: null, github: null },
};

describe('sanitizeExtraction', () => {
  it('keeps a clean extraction and fills the keys the model left out with null', () => {
    expect(sanitizeExtraction(SAMPLE)).toEqual({
      ...SAMPLE,
      address: { line1: null, city: 'Chennai', state: 'Tamil Nadu', postalCode: null, country: 'India' },
    });
  });

  it('lowercases and trims the e-mail, trims text, and turns empty strings into null', () => {
    const data = sanitizeExtraction({ fullName: '  Arun Kumar ', email: '  Arun@Example.COM ', department: '   ' });
    expect(data.fullName).toBe('Arun Kumar');
    expect(data.email).toBe('arun@example.com');
    expect(data.department).toBeNull();
  });

  it('nulls invented or malformed values instead of failing the scan', () => {
    const data = sanitizeExtraction({
      fullName: 'Arun',
      email: 'not-an-email',
      mobile: 'call me maybe',
      website: 'javascript:alert(1)',
      socialLinks: { linkedin: 'ftp://x.example/arun', github: 'github.com/arun' },
    });
    expect(data.fullName).toBe('Arun');
    expect(data.email).toBeNull();
    expect(data.mobile).toBeNull();
    expect(data.website).toBeNull();
    expect(data.socialLinks.linkedin).toBeNull();
    expect(data.socialLinks.github).toBe('https://github.com/arun');
  });

  it('adds https:// to a bare domain', () => {
    expect(sanitizeExtraction({ website: 'www.example.com/about' }).website).toBe('https://www.example.com/about');
  });

  it('rejects a phone number with too few digits', () => {
    expect(sanitizeExtraction({ mobile: '12' }).mobile).toBeNull();
    expect(sanitizeExtraction({ mobile: '+91 (98765) 43210' }).mobile).toBe('+91 (98765) 43210');
  });

  it('ignores wrong types, unknown keys and a non-object answer', () => {
    expect(sanitizeExtraction({ fullName: 42, email: ['a@b.co'], extra: 'x', address: 'Chennai' })).toEqual(
      emptyBusinessCardData(),
    );
    expect(sanitizeExtraction('nope')).toEqual(emptyBusinessCardData());
    expect(sanitizeExtraction(null)).toEqual(emptyBusinessCardData());
    expect(sanitizeExtraction([SAMPLE])).toEqual(emptyBusinessCardData());
  });

  it('drops values that are over the length limit', () => {
    expect(sanitizeExtraction({ fullName: 'x'.repeat(241) }).fullName).toBeNull();
  });
});

describe('businessCardPatchSchema + applyPatch', () => {
  const current = sanitizeExtraction(SAMPLE);

  it('changes only what was sent and merges nested objects', () => {
    const patch = businessCardPatchSchema.parse({ jobTitle: 'Lead', address: { city: 'Madurai' } });
    const next = applyPatch(current, patch);
    expect(next.jobTitle).toBe('Lead');
    expect(next.fullName).toBe('Arun Kumar');
    expect(next.address).toEqual({ ...current.address, city: 'Madurai' });
  });

  it('lets a field be cleared with null or an empty string', () => {
    const next = applyPatch(current, businessCardPatchSchema.parse({ department: '', email: null }));
    expect(next.department).toBeNull();
    expect(next.email).toBeNull();
  });

  it('refuses an invalid e-mail, link or phone number in an edit', () => {
    expect(businessCardPatchSchema.safeParse({ email: 'nope' }).success).toBe(false);
    expect(businessCardPatchSchema.safeParse({ website: 'javascript:alert(1)' }).success).toBe(false);
    expect(businessCardPatchSchema.safeParse({ mobile: 'abc' }).success).toBe(false);
    expect(businessCardPatchSchema.safeParse({ socialLinks: { github: 'not a link' } }).success).toBe(false);
  });
});

describe('hasContactInformation', () => {
  it('needs a name, company, e-mail or phone number', () => {
    expect(hasContactInformation(emptyBusinessCardData())).toBe(false);
    expect(hasContactInformation({ ...emptyBusinessCardData(), jobTitle: 'CEO' })).toBe(false);
    expect(hasContactInformation({ ...emptyBusinessCardData(), email: 'a@b.co' })).toBe(true);
    expect(hasContactInformation({ ...emptyBusinessCardData(), companyName: 'ABC' })).toBe(true);
  });
});
