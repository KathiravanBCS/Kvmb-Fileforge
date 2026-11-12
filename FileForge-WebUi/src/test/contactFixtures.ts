import type { BusinessCard, CardData } from '@/features/business-cards/types';
import type { Contact, ContactSummary } from '@/features/contacts/types';

export const cardData = (overrides: Partial<CardData> = {}): CardData => ({
  fullName: 'Arun Kumar',
  jobTitle: 'Software Developer',
  companyName: 'ABC Technologies',
  department: 'Engineering',
  email: 'arun@example.com',
  mobile: '+91 9876543210',
  website: 'https://example.com',
  address: { line1: null, city: 'Chennai', state: 'Tamil Nadu', postalCode: null, country: 'India' },
  socialLinks: { linkedin: null, github: null },
  ...overrides,
});

export const emptyCardData = (): CardData => ({
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

export const card = (overrides: Partial<BusinessCard> = {}): BusinessCard => ({
  id: '12',
  status: 'pending',
  data: cardData(),
  imageFileId: '7',
  backImageFileId: null,
  contactId: null,
  model: 'qwen/qwen3.8-27b',
  createdAt: '2026-11-12T10:00:00.000Z',
  reviewedAt: null,
  ...overrides,
});

export const cardPage = (items: BusinessCard[], total = items.length) => ({ items, page: 1, pageSize: 25, total });

export const contactSummary = (overrides: Partial<ContactSummary> = {}): ContactSummary => ({
  id: '5',
  displayName: 'Arun Kumar',
  organization: 'ABC Technologies',
  jobTitle: 'Software Developer',
  email: 'arun@example.com',
  phone: '+91 9876543210',
  reviewStatus: 'unreviewed',
  createdAt: '2026-11-12T10:05:00.000Z',
  ...overrides,
});

export const contact = (overrides: Partial<Contact> = {}): Contact => ({
  id: '5',
  displayName: 'Arun Kumar',
  firstName: 'Arun',
  lastName: 'Kumar',
  organization: 'ABC Technologies',
  jobTitle: 'Software Developer',
  department: 'Engineering',
  notes: null,
  reviewStatus: 'unreviewed',
  source: { type: 'business_card', recordId: '12' },
  methods: [
    { id: '1', type: 'email', label: 'work', value: 'arun@example.com', isPrimary: true },
    { id: '2', type: 'phone', label: 'mobile', value: '+91 9876543210', isPrimary: true },
    { id: '3', type: 'website', label: 'work', value: 'https://example.com', isPrimary: false },
    { id: '4', type: 'social', label: 'linkedin', value: 'javascript:alert(1)', isPrimary: false },
  ],
  addresses: [{ id: '1', line1: null, city: 'Chennai', region: 'Tamil Nadu', postalCode: null, country: 'India' }],
  links: [{ entityType: 'business_card_scan', entityId: '12', relationship: 'source' }],
  createdAt: '2026-11-12T10:05:00.000Z',
  updatedAt: null,
  ...overrides,
});

export const contactPage = (items: ContactSummary[], total = items.length) => ({ items, page: 1, pageSize: 25, total });
