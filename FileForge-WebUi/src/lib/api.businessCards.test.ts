import { beforeEach, describe, expect, it, vi } from 'vitest';

import { card, cardPage, contact, contactPage } from '@/test/contactFixtures';
import { api } from './api';
import { apiClient } from './api-client';
import { ApiError } from './api-types';

// The real service layer over a stubbed HTTP client: these tests are about WHICH endpoint is called and WHAT is sent.
vi.mock('./api-client', () => ({
  API_URL: 'http://localhost:4000/api/v1',
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn(), download: vi.fn() },
}));

const http = vi.mocked(apiClient);
beforeEach(() => vi.clearAllMocks());

describe('business cards', () => {
  it('lists from the workspace route with the paging and status the API accepts', async () => {
    http.get.mockResolvedValue(cardPage([card()]));
    const page = await api.businessCards.list('1', { page: 2, pageSize: 25, status: 'pending' });
    expect(http.get).toHaveBeenCalledWith('/workspaces/1/business-cards', expect.objectContaining({ params: { page: 2, pageSize: 25, status: 'pending' } }));
    expect(page.items[0]?.data.fullName).toBe('Arun Kumar');
  });

  it('uploads the front as multipart under the field name the API reads (`front`), and no back when there is none', async () => {
    http.upload.mockResolvedValue(card());
    await api.businessCards.scan('1', { front: new File(['x'], 'front.jpg', { type: 'image/jpeg' }) });
    const [url, form] = http.upload.mock.calls[0] as [string, FormData];
    expect(url).toBe('/workspaces/1/business-cards/scan');
    expect((form.get('front') as File).name).toBe('front.jpg');
    expect(form.has('back')).toBe(false);
  });

  it('sends the back of the card in the same request, as `back`', async () => {
    http.upload.mockResolvedValue(card({ backImageFileId: '8' }));
    const result = await api.businessCards.scan('1', {
      front: new File(['f'], 'front.jpg', { type: 'image/jpeg' }),
      back: new File(['b'], 'back.jpg', { type: 'image/jpeg' }),
    });
    const [, form] = http.upload.mock.calls[0] as [string, FormData];
    expect((form.get('front') as File).name).toBe('front.jpg');
    expect((form.get('back') as File).name).toBe('back.jpg');
    expect(result.backImageFileId).toBe('8');
  });

  it('corrects, approves and rejects through their own routes', async () => {
    http.patch.mockResolvedValue(card());
    http.post.mockResolvedValue(card({ status: 'approved', contactId: '5' }));
    await api.businessCards.update('1', '12', { jobTitle: 'Lead', address: { city: 'Madurai' } });
    expect(http.patch).toHaveBeenCalledWith('/workspaces/1/business-cards/12', { jobTitle: 'Lead', address: { city: 'Madurai' } }, undefined);
    expect((await api.businessCards.approve('1', '12')).contactId).toBe('5');
    expect(http.post).toHaveBeenCalledWith('/workspaces/1/business-cards/12/approve', undefined, undefined);
    await api.businessCards.reject('1', '12');
    expect(http.post).toHaveBeenLastCalledWith('/workspaces/1/business-cards/12/reject', undefined, undefined);
  });

  it('fetches the photo of the requested side from the image route', async () => {
    http.download.mockResolvedValue(new Blob(['x']));
    await api.businessCards.image('1', '12', 'front');
    expect(http.download).toHaveBeenLastCalledWith('/workspaces/1/business-cards/12/image', { params: { side: 'front' } });
    await api.businessCards.image('1', '12', 'back');
    expect(http.download).toHaveBeenLastCalledWith('/workspaces/1/business-cards/12/image', { params: { side: 'back' } });
  });

  it('encodes ids that go into the path', async () => {
    http.get.mockResolvedValue(card());
    await api.businessCards.get('1', '12/../x');
    expect(http.get).toHaveBeenCalledWith('/workspaces/1/business-cards/12%2F..%2Fx', undefined);
  });

  it('fails loudly when the server answers with something that is not a business card', async () => {
    http.get.mockResolvedValue({ id: 'abc', status: 'weird' });
    await expect(api.businessCards.get('1', '12')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('contacts', () => {
  it('lists with search and review status, dropping an empty search', async () => {
    http.get.mockResolvedValue(contactPage([]));
    await api.contacts.list('1', { page: 1, pageSize: 25, q: '', reviewStatus: 'reviewed' });
    expect(http.get).toHaveBeenCalledWith('/workspaces/1/contacts', expect.objectContaining({ params: { page: 1, pageSize: 25, q: undefined, reviewStatus: 'reviewed' } }));
  });

  it('reads one contact with the records it is linked to', async () => {
    http.get.mockResolvedValue(contact());
    const result = await api.contacts.get('1', '5');
    expect(http.get).toHaveBeenCalledWith('/workspaces/1/contacts/5', undefined);
    expect(result.links).toEqual([{ entityType: 'business_card_scan', entityId: '12', relationship: 'source' }]);
  });

  it('changes and deletes on the contact route', async () => {
    http.patch.mockResolvedValue(contact());
    http.delete.mockResolvedValue(undefined);
    await api.contacts.update('1', '5', { notes: 'Met at the expo', department: null });
    expect(http.patch).toHaveBeenCalledWith('/workspaces/1/contacts/5', { notes: 'Met at the expo', department: null }, undefined);
    await api.contacts.remove('1', '5');
    expect(http.delete).toHaveBeenCalledWith('/workspaces/1/contacts/5', undefined);
  });
});
