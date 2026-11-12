import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-types';
import { contact, contactPage, contactSummary } from '@/test/contactFixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import type { Contact, ContactSummary } from '../types';
import { ContactsPage } from './ContactsPage';

vi.mock('@/lib/api');

const contacts = vi.mocked(api.contacts, { deep: true });

function stubApi({ role = 'owner', items = [contactSummary()], detail = contact() }: { role?: string; items?: ContactSummary[]; detail?: Contact } = {}) {
  vi.mocked(api.workspaces.list).mockResolvedValue([{ id: '1', name: 'Alice workspace', type: 'personal', role }]);
  contacts.list.mockResolvedValue(contactPage(items));
  contacts.get.mockResolvedValue(detail);
  contacts.update.mockImplementation(async (_w: string, _id: string, patch) => ({ ...detail, ...patch, updatedAt: '2026-11-13T09:00:00.000Z' }) as Contact);
  contacts.remove.mockResolvedValue(undefined);
}

const drawer = async () => within(await screen.findByRole('dialog'));

beforeEach(() => {
  // Call history must never leak from one test into the next (clearing each mock directly works in every vitest pool mode).
  for (const fn of Object.values(contacts)) (fn as { mockClear: () => void }).mockClear();
  stubApi();
});

describe('Contacts: the list', () => {
  it('lists the workspace’s contacts', async () => {
    stubApi({ items: [contactSummary(), contactSummary({ id: '6', displayName: 'Priya Rao', organization: 'XYZ Ltd', email: null, phone: null })] });
    renderWithProviders(<ContactsPage />);

    expect(await screen.findByText('Arun Kumar')).toBeInTheDocument();
    expect(screen.getByText('Priya Rao')).toBeInTheDocument();
    expect(screen.getByText('XYZ Ltd')).toBeInTheDocument();
    expect(screen.getByText('arun@example.com')).toBeInTheDocument();
    expect(contacts.list).toHaveBeenCalledWith('1', { page: 1, pageSize: 25, q: undefined, reviewStatus: undefined }, expect.anything());
  });

  it('searches through the API (after the user stops typing)', async () => {
    renderWithProviders(<ContactsPage />);
    await screen.findByText('Arun Kumar');
    await userEvent.type(screen.getByLabelText('Search contacts'), 'abc');
    await waitFor(() => expect(contacts.list).toHaveBeenLastCalledWith('1', expect.objectContaining({ q: 'abc', page: 1 }), expect.anything()));
  });

  it('says when nothing matches, and when there are no contacts at all', async () => {
    stubApi({ items: [] });
    renderWithProviders(<ContactsPage />);
    expect(await screen.findByText('No contacts yet')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search contacts'), 'zzz');
    expect(await screen.findByText('No contacts match')).toBeInTheDocument();
  });

  it('explains a load failure instead of showing an empty list', async () => {
    contacts.list.mockRejectedValue(new ApiError('The server had a problem.', { status: 500 }));
    renderWithProviders(<ContactsPage />);
    expect(await screen.findByText('Your contacts could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('The server had a problem.')).toBeInTheDocument();
  });
});

describe('Contacts: one contact', () => {
  it('shows the details and links e-mail, phone and web addresses', async () => {
    renderWithProviders(<ContactsPage />);
    await userEvent.click(await screen.findByRole('row', { name: 'Open Arun Kumar' }));

    const view = await drawer();
    expect(await view.findByText('Software Developer · Engineering')).toBeInTheDocument();
    expect(view.getByRole('link', { name: 'arun@example.com' })).toHaveAttribute('href', 'mailto:arun@example.com');
    expect(view.getByRole('link', { name: '+91 9876543210' })).toHaveAttribute('href', 'tel:+919876543210');
    expect(view.getByRole('link', { name: 'https://example.com' })).toHaveAttribute('href', 'https://example.com');
    expect(view.getByText('Chennai, Tamil Nadu, India')).toBeInTheDocument();
  });

  it('never turns a stored value that is not an http(s) address into a link', async () => {
    renderWithProviders(<ContactsPage />, { route: '/contacts?open=5' });
    const view = await drawer();
    await view.findByText('javascript:alert(1)');
    expect(view.queryByRole('link', { name: /javascript/ })).not.toBeInTheDocument();
  });

  it('shows the records it is linked to, and links a business card back to its scan', async () => {
    renderWithProviders(<ContactsPage />, { route: '/contacts?open=5' });
    const view = await drawer();
    expect(await view.findByRole('link', { name: 'Business card #12' })).toHaveAttribute('href', '/business-cards?open=12');
  });

  it('lists a record type it does not know by name, without a link', async () => {
    stubApi({ detail: contact({ links: [{ entityType: 'qr_item', entityId: '9', relationship: 'source' }] }) });
    renderWithProviders(<ContactsPage />, { route: '/contacts?open=5' });
    const view = await drawer();
    expect(await view.findByText('qr item #9')).toBeInTheDocument();
    expect(view.queryByRole('link', { name: /qr item/ })).not.toBeInTheDocument();
  });

  it('edits the contact and sends only the editable fields', async () => {
    renderWithProviders(<ContactsPage />, { route: '/contacts?open=5' });
    const view = await drawer();
    await userEvent.click(await view.findByRole('button', { name: 'Edit' }));

    const title = view.getByLabelText('Job title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Lead');
    await userEvent.type(view.getByLabelText('Notes'), 'Met at the expo');
    await userEvent.click(view.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(contacts.update).toHaveBeenCalledWith(
        '1',
        '5',
        { displayName: 'Arun Kumar', organization: 'ABC Technologies', jobTitle: 'Lead', department: 'Engineering', notes: 'Met at the expo', reviewStatus: 'unreviewed' },
      ),
    );
  });

  it('will not save a contact without a name', async () => {
    renderWithProviders(<ContactsPage />, { route: '/contacts?open=5' });
    const view = await drawer();
    await userEvent.click(await view.findByRole('button', { name: 'Edit' }));
    await userEvent.clear(view.getByLabelText(/Name/));
    expect(view.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(await view.findByText('A name is required.')).toBeInTheDocument();
  });

  it('shows why a save failed and stays in edit mode', async () => {
    contacts.update.mockRejectedValue(new ApiError('Contact not found.', { status: 404 }));
    renderWithProviders(<ContactsPage />, { route: '/contacts?open=5' });
    const view = await drawer();
    await userEvent.click(await view.findByRole('button', { name: 'Edit' }));
    await userEvent.type(view.getByLabelText('Notes'), 'x');
    await userEvent.click(view.getByRole('button', { name: 'Save' }));
    expect(await view.findByRole('alert')).toHaveTextContent('Contact not found.');
    expect(view.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('asks before deleting, then deletes', async () => {
    renderWithProviders(<ContactsPage />, { route: '/contacts?open=5' });
    const view = await drawer();
    await userEvent.click(await view.findByRole('button', { name: 'Delete contact' }));
    expect(contacts.remove).not.toHaveBeenCalled();

    const confirm = within(await screen.findByRole('dialog', { name: 'Delete this contact?' }));
    await userEvent.click(confirm.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(contacts.remove).toHaveBeenCalledWith('1', '5'));
  });

  it('lets a viewer look at a contact but not change it', async () => {
    stubApi({ role: 'viewer' });
    renderWithProviders(<ContactsPage />, { route: '/contacts?open=5' });
    const view = await drawer();
    await view.findByText('Software Developer · Engineering');
    expect(view.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(view.queryByRole('button', { name: 'Delete contact' })).not.toBeInTheDocument();
  });

  it('says so when the contact cannot be opened', async () => {
    contacts.get.mockRejectedValue(new ApiError('Contact not found.', { status: 404 }));
    renderWithProviders(<ContactsPage />, { route: '/contacts?open=999' });
    const view = await drawer();
    expect(await view.findByText('This contact could not be opened')).toBeInTheDocument();
    expect(view.getByText('Contact not found.')).toBeInTheDocument();
  });
});
