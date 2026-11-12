import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-types';
import { card, cardData, cardPage, emptyCardData } from '@/test/contactFixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import type { BusinessCard } from '../types';
import { BusinessCardsPage } from './BusinessCardsPage';

vi.mock('@/lib/api');

// The camera window is tested on its own (CardSession.test.tsx). Here it is a stub with three buttons, so the page's reaction to
// "a card was captured", "only a back was captured" and "closed" can be driven without a camera.
vi.mock('../components/CardSession', () => ({
  CardSession: (props: {
    opened: boolean;
    onClose: () => void;
    onAddCard: (card: { front: File; back?: File }) => void;
    queuedCount: number;
    backOf?: { label: string; onBack: (file: File) => void } | null;
  }) =>
    props.opened ? (
      <div role="dialog" aria-label="camera window">
        <span>{props.backOf ? `back of ${props.backOf.label}` : `new card ${props.queuedCount + 1}`}</span>
        <button
          onClick={() =>
            props.backOf
              ? props.backOf.onBack(new File(['b'], 'back.jpg', { type: 'image/jpeg' }))
              : props.onAddCard({
                  front: new File(['f'], 'front.jpg', { type: 'image/jpeg' }),
                  back: new File(['b'], 'back.jpg', { type: 'image/jpeg' }),
                })
          }
        >
          stub shoot
        </button>
        <button onClick={() => props.onAddCard({ front: new File(['f2'], 'front-only.jpg', { type: 'image/jpeg' }) })}>
          stub shoot front only
        </button>
        <button onClick={props.onClose}>stub close</button>
      </div>
    ) : null,
}));

const cards = vi.mocked(api.businessCards, { deep: true });

function stubApi({ role = 'owner', items = [card()] }: { role?: string; items?: BusinessCard[] } = {}) {
  vi.mocked(api.workspaces.list).mockResolvedValue([{ id: '1', name: 'Alice workspace', type: 'personal', role }]);
  cards.list.mockResolvedValue(cardPage(items));
  cards.get.mockImplementation(async (_workspace: string, id: string) => items.find((c) => c.id === id) ?? card({ id }));
  cards.image.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  cards.update.mockImplementation(async (_w: string, id: string) => card({ id }));
  cards.approve.mockImplementation(async (_w: string, id: string) => card({ id, status: 'approved', contactId: '5' }));
  cards.reject.mockImplementation(async (_w: string, id: string) => card({ id, status: 'rejected' }));
}

const photo = (name = 'card.jpg', type = 'image/jpeg') => new File(['x'], name, { type });
const chooseFiles = (...files: File[]) => fireEvent.change(screen.getByTestId('card-file-input'), { target: { files } });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const cameraWindow = () => screen.findByRole('dialog', { name: 'camera window' });
const queue = () => screen.findByLabelText('Cards waiting to be scanned');
const drawer = async () => within(await screen.findByRole('dialog'));

beforeEach(() => {
  // Call history must never leak from one test into the next (clearing each mock directly works in every vitest pool mode).
  for (const fn of Object.values(cards)) (fn as { mockClear: () => void }).mockClear();
  stubApi();
});

describe('Business cards: the list', () => {
  it('lists the user’s scans with who they are, their company and a status', async () => {
    stubApi({ items: [card(), card({ id: '13', status: 'approved', contactId: '5', data: cardData({ fullName: 'Priya Rao', companyName: 'XYZ Ltd' }) })] });
    renderWithProviders(<BusinessCardsPage />);

    expect(await screen.findByText('Arun Kumar')).toBeInTheDocument();
    expect(screen.getByText('Priya Rao')).toBeInTheDocument();
    expect(screen.getByText('XYZ Ltd')).toBeInTheDocument();
    const table = within(screen.getByRole('table', { name: 'Scanned business cards' }));
    expect(table.getByText('To review')).toBeInTheDocument();
    expect(table.getByText('Saved')).toBeInTheDocument();
    expect(cards.list).toHaveBeenCalledWith('1', { page: 1, pageSize: 25, status: undefined }, expect.anything());
  });

  it('shows an empty state that says what to do', async () => {
    stubApi({ items: [] });
    renderWithProviders(<BusinessCardsPage />);
    expect(await screen.findByText('No cards scanned yet')).toBeInTheDocument();
  });

  it('filters by status through the API', async () => {
    renderWithProviders(<BusinessCardsPage />);
    await screen.findByText('Arun Kumar');
    await userEvent.click(screen.getByText('Discarded'));
    await waitFor(() => expect(cards.list).toHaveBeenLastCalledWith('1', { page: 1, pageSize: 25, status: 'rejected' }, expect.anything()));
  });

  it('explains a load failure instead of showing an empty list', async () => {
    cards.list.mockRejectedValue(new ApiError('The server had a problem.', { status: 500 }));
    renderWithProviders(<BusinessCardsPage />);
    expect(await screen.findByText('Your scanned cards could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('The server had a problem.')).toBeInTheDocument();
  });
});

describe('Business cards: the scan queue', () => {
  it('holds photos in a queue and uploads nothing until the user says scan', async () => {
    renderWithProviders(<BusinessCardsPage />);
    await screen.findByText('Arun Kumar');
    chooseFiles(photo('a.jpg'), photo('b.png', 'image/png'));

    const waiting = within(await queue());
    expect(waiting.getByText('2 cards ready to scan')).toBeInTheDocument();
    expect(waiting.getByText('Card 1')).toBeInTheDocument();
    expect(waiting.getByText('Card 2')).toBeInTheDocument();
    expect(cards.scan).not.toHaveBeenCalled();
  });

  it('scans a single card and opens its result for review', async () => {
    cards.scan.mockResolvedValue(card({ id: '20', data: cardData({ fullName: 'Scanned Person' }) }));
    cards.get.mockResolvedValue(card({ id: '20', data: cardData({ fullName: 'Scanned Person' }) }));
    renderWithProviders(<BusinessCardsPage />);
    await screen.findByText('Arun Kumar');

    const file = photo();
    chooseFiles(file);
    await userEvent.click(within(await queue()).getByRole('button', { name: 'Scan the card' }));

    await waitFor(() => expect(cards.scan).toHaveBeenCalledWith('1', { front: file, back: undefined }, expect.anything()));
    const review = await drawer();
    expect(await review.findByLabelText('Full name')).toHaveValue('Scanned Person');
    expect(screen.queryByLabelText('Cards waiting to be scanned')).not.toBeInTheDocument(); // the scanned card left the queue
  });

  it('scans several cards ONE AT A TIME, in order, then shows the cards to review', async () => {
    const first = deferred<BusinessCard>();
    cards.scan.mockReturnValueOnce(first.promise).mockResolvedValueOnce(card({ id: '22' }));
    renderWithProviders(<BusinessCardsPage />);
    await screen.findByText('Arun Kumar');
    const [a, b] = [photo('a.jpg'), photo('b.jpg')];
    chooseFiles(a, b);
    await userEvent.click(within(await queue()).getByRole('button', { name: 'Scan all 2 cards' }));

    await waitFor(() => expect(cards.scan).toHaveBeenCalledTimes(1));
    expect(cards.scan.mock.calls[0]?.[1]).toEqual({ front: a, back: undefined });
    expect(within(await queue()).getByText('Reading…')).toBeInTheDocument();
    expect(cards.scan).toHaveBeenCalledTimes(1); // the second waits for the first

    first.resolve(card({ id: '21' }));
    await waitFor(() => expect(cards.scan).toHaveBeenCalledTimes(2));
    expect(cards.scan.mock.calls[1]?.[1]).toEqual({ front: b, back: undefined });

    expect(await screen.findByText('2 cards scanned')).toBeInTheDocument();
    await waitFor(() => expect(cards.list).toHaveBeenLastCalledWith('1', { page: 1, pageSize: 25, status: 'pending' }, expect.anything()));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); // several cards: no single review is forced open
  });

  it('keeps a card that failed (with the reason), carries on with the next, and can scan the failed one again', async () => {
    cards.scan
      .mockRejectedValueOnce(new ApiError('The card could not be read. Try a clearer photo.', { status: 502 }))
      .mockResolvedValueOnce(card({ id: '31' }));
    renderWithProviders(<BusinessCardsPage />);
    await screen.findByText('Arun Kumar');
    chooseFiles(photo('blurry.jpg'), photo('good.jpg'));
    await userEvent.click(within(await queue()).getByRole('button', { name: 'Scan all 2 cards' }));

    await waitFor(() => expect(cards.scan).toHaveBeenCalledTimes(2)); // the second was tried although the first failed
    const waiting = within(await queue());
    expect(await waiting.findByText('The card could not be read. Try a clearer photo.')).toBeInTheDocument();
    expect(waiting.getByText('1 card ready to scan')).toBeInTheDocument(); // only the failed one is left
    expect(waiting.getByText('Failed')).toBeInTheDocument();

    cards.scan.mockResolvedValueOnce(card({ id: '32' }));
    await userEvent.click(waiting.getByRole('button', { name: 'Scan again' }));
    await waitFor(() => expect(cards.scan).toHaveBeenCalledTimes(3));
  });

  it('pauses on a rate limit: says why, and keeps this card and the rest waiting instead of failing them', async () => {
    cards.scan
      .mockResolvedValueOnce(card({ id: '41' }))
      .mockRejectedValueOnce(new ApiError('Too many cards were scanned in a short time. Try again in about 12 seconds.', { status: 429 }));
    renderWithProviders(<BusinessCardsPage />);
    await screen.findByText('Arun Kumar');
    chooseFiles(photo('1.jpg'), photo('2.jpg'), photo('3.jpg'));
    await userEvent.click(within(await queue()).getByRole('button', { name: 'Scan all 3 cards' }));

    const paused = await screen.findByText(/Try again in about 12 seconds/);
    expect(paused).toBeInTheDocument();
    expect(cards.scan).toHaveBeenCalledTimes(2); // the third was never attempted
    const waiting = within(await queue());
    expect(waiting.getByText('2 cards ready to scan')).toBeInTheDocument();
    expect(waiting.getAllByText('Waiting')).toHaveLength(2);
    expect(waiting.queryByText('Failed')).not.toBeInTheDocument();
  });

  it('lets a card be taken out of the queue', async () => {
    renderWithProviders(<BusinessCardsPage />);
    await screen.findByText('Arun Kumar');
    chooseFiles(photo('a.jpg'), photo('b.jpg'));
    await userEvent.click(within(await queue()).getByRole('button', { name: 'Remove card 1' }));
    expect(within(await queue()).getByText('1 card ready to scan')).toBeInTheDocument();
    await userEvent.click(within(await queue()).getByRole('button', { name: 'Remove card 1' }));
    await waitFor(() => expect(screen.queryByLabelText('Cards waiting to be scanned')).not.toBeInTheDocument());
  });

  it('adds the valid photos of a selection and names each one it refused, and why', async () => {
    renderWithProviders(<BusinessCardsPage />);
    await screen.findByText('Arun Kumar');
    const big = photo('huge.jpg');
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    chooseFiles(photo('ok.jpg'), photo('notes.pdf', 'application/pdf'), big);

    expect(await screen.findByText(/notes\.pdf: Use a JPG, PNG or WebP photo/)).toBeInTheDocument();
    expect(screen.getByText(/huge\.jpg: The photo is too large/)).toBeInTheDocument();
    expect(within(await queue()).getByText('1 card ready to scan')).toBeInTheDocument();
    expect(cards.scan).not.toHaveBeenCalled();
  });

  it('does not offer scanning to a viewer: no camera, no photos', async () => {
    stubApi({ role: 'viewer' });
    renderWithProviders(<BusinessCardsPage />);
    expect(await screen.findByText(/can view cards but not scan them/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /scan with camera/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /add card photos/i })).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('Business cards: the camera window', () => {
  it('opens from "Scan with camera" and numbers the next card after the ones already waiting', async () => {
    renderWithProviders(<BusinessCardsPage />);
    await screen.findByText('Arun Kumar');
    chooseFiles(photo('a.jpg'));
    await queue();

    await userEvent.click(screen.getByRole('button', { name: /scan with camera/i }));
    expect(within(await cameraWindow()).getByText('new card 2')).toBeInTheDocument();
  });

  it('adds a card with BOTH sides to the queue, and sends both together when scanned', async () => {
    cards.scan.mockResolvedValue(card({ id: '50', backImageFileId: '51' }));
    cards.get.mockResolvedValue(card({ id: '50', backImageFileId: '51' }));
    renderWithProviders(<BusinessCardsPage />);
    await screen.findByText('Arun Kumar');
    await userEvent.click(screen.getByRole('button', { name: /scan with camera/i }));
    await userEvent.click(within(await cameraWindow()).getByRole('button', { name: 'stub shoot' }));

    const waiting = within(await queue());
    expect(waiting.getByAltText('Front of card 1')).toBeInTheDocument();
    expect(waiting.getByAltText('Back of card 1')).toBeInTheDocument();
    expect(waiting.queryByRole('button', { name: /add the back of card 1/i })).not.toBeInTheDocument();

    await userEvent.click(waiting.getByRole('button', { name: 'Scan the card' }));
    await waitFor(() => expect(cards.scan).toHaveBeenCalledTimes(1));
    const sent = cards.scan.mock.calls[0]?.[1] as { front: File; back: File };
    expect([sent.front.name, sent.back.name]).toEqual(['front.jpg', 'back.jpg']);
  });

  it('lets the back be added later to a card that was added with only a front', async () => {
    renderWithProviders(<BusinessCardsPage />);
    await screen.findByText('Arun Kumar');
    chooseFiles(photo('front-only.jpg'));
    await userEvent.click(within(await queue()).getByRole('button', { name: 'Add the back of card 1' }));

    const win = within(await cameraWindow());
    expect(win.getByText('back of card 1')).toBeInTheDocument();
    await userEvent.click(win.getByRole('button', { name: 'stub shoot' }));

    const waiting = within(await queue());
    expect(await waiting.findByAltText('Back of card 1')).toBeInTheDocument();
    expect(waiting.queryByRole('button', { name: 'Add the back of card 1' })).not.toBeInTheDocument();
  });

  it('keeps adding cards while the window stays open, and closes on request', async () => {
    renderWithProviders(<BusinessCardsPage />);
    await screen.findByText('Arun Kumar');
    await userEvent.click(screen.getByRole('button', { name: /scan with camera/i }));
    const win = within(await cameraWindow());
    await userEvent.click(win.getByRole('button', { name: 'stub shoot front only' }));
    await userEvent.click(win.getByRole('button', { name: 'stub shoot front only' }));

    expect(within(await queue()).getByText('2 cards ready to scan')).toBeInTheDocument();
    await userEvent.click(win.getByRole('button', { name: 'stub close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'camera window' })).not.toBeInTheDocument());
  });
});

describe('Business cards: review', () => {
  it('opens a card from the list with every field filled in and the photo requested', async () => {
    renderWithProviders(<BusinessCardsPage />);
    await userEvent.click(await screen.findByRole('row', { name: 'Open Arun Kumar' }));

    const review = await drawer();
    expect(await review.findByLabelText('Full name')).toHaveValue('Arun Kumar');
    expect(review.getByLabelText('E-mail')).toHaveValue('arun@example.com');
    expect(review.getByLabelText('Mobile')).toHaveValue('+91 9876543210');
    expect(review.getByLabelText('Company')).toHaveValue('ABC Technologies');
    expect(review.getByLabelText('State')).toHaveValue('Tamil Nadu');
    await waitFor(() => expect(cards.image).toHaveBeenCalledWith('1', '12', 'front', expect.anything()));
  });

  it('saves an untouched card as a contact without editing it first', async () => {
    renderWithProviders(<BusinessCardsPage />, { route: '/business-cards?open=12' });
    const review = await drawer();
    await review.findByLabelText('Full name');

    expect(review.getByRole('button', { name: 'Save changes' })).toBeDisabled(); // nothing changed
    await userEvent.click(review.getByRole('button', { name: 'Save as contact' }));

    await waitFor(() => expect(cards.approve).toHaveBeenCalledWith('1', '12'));
    expect(cards.update).not.toHaveBeenCalled();
    expect(await screen.findByText('Contact saved')).toBeInTheDocument();
  });

  it('saves the corrections first, then approves, in that order', async () => {
    const order: string[] = [];
    cards.update.mockImplementation(async (_w: string, id: string) => (order.push('update'), card({ id })));
    cards.approve.mockImplementation(async (_w: string, id: string) => (order.push('approve'), card({ id, status: 'approved', contactId: '5' })));
    renderWithProviders(<BusinessCardsPage />, { route: '/business-cards?open=12' });
    const review = await drawer();

    const city = await review.findByLabelText('City');
    await userEvent.clear(city);
    await userEvent.type(city, 'Madurai');
    await userEvent.click(review.getByRole('button', { name: 'Save as contact' }));

    await waitFor(() => expect(cards.approve).toHaveBeenCalled());
    expect(order).toEqual(['update', 'approve']);
    expect(cards.update).toHaveBeenCalledWith('1', '12', expect.objectContaining({ address: expect.objectContaining({ city: 'Madurai', state: 'Tamil Nadu' }) }));
  });

  it('saves corrections without approving when asked to', async () => {
    renderWithProviders(<BusinessCardsPage />, { route: '/business-cards?open=12' });
    const review = await drawer();
    const title = await review.findByLabelText('Job title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Lead');
    await userEvent.click(review.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(cards.update).toHaveBeenCalledWith('1', '12', expect.objectContaining({ jobTitle: 'Lead' })));
    expect(cards.approve).not.toHaveBeenCalled();
  });

  it('explains a mistake next to its field and sends nothing', async () => {
    renderWithProviders(<BusinessCardsPage />, { route: '/business-cards?open=12' });
    const review = await drawer();
    const email = await review.findByLabelText('E-mail');
    await userEvent.clear(email);
    await userEvent.type(email, 'not-an-email');
    await userEvent.click(review.getByRole('button', { name: 'Save as contact' }));

    expect(await review.findByText('Enter a valid e-mail address.')).toBeInTheDocument();
    expect(cards.update).not.toHaveBeenCalled();
    expect(cards.approve).not.toHaveBeenCalled();
  });

  it('warns about a card nothing could be read from, and will not save it until something is typed in', async () => {
    stubApi({ items: [card({ data: emptyCardData() })] });
    renderWithProviders(<BusinessCardsPage />, { route: '/business-cards?open=12' });
    const review = await drawer();

    expect(await review.findByText('Nothing could be read from this card')).toBeInTheDocument();
    expect(review.getByRole('button', { name: 'Save as contact' })).toBeDisabled();
    await userEvent.type(review.getByLabelText('Full name'), 'Typed By Hand');
    expect(review.getByRole('button', { name: 'Save as contact' })).toBeEnabled();
  });

  it('shows why a save failed and keeps the drawer open', async () => {
    cards.approve.mockRejectedValue(new ApiError('This card has already been saved or discarded.', { status: 409 }));
    renderWithProviders(<BusinessCardsPage />, { route: '/business-cards?open=12' });
    const review = await drawer();
    await review.findByLabelText('Full name');
    await userEvent.click(review.getByRole('button', { name: 'Save as contact' }));

    expect(await review.findByRole('alert')).toHaveTextContent('already been saved or discarded');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('asks before discarding, then rejects the card', async () => {
    renderWithProviders(<BusinessCardsPage />, { route: '/business-cards?open=12' });
    const review = await drawer();
    await review.findByLabelText('Full name');
    await userEvent.click(review.getByRole('button', { name: 'Discard card' }));
    expect(cards.reject).not.toHaveBeenCalled();

    const confirm = within(await screen.findByRole('dialog', { name: 'Discard this card?' }));
    await userEvent.click(confirm.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(cards.reject).toHaveBeenCalledWith('1', '12'));
  });

  it('shows a saved card read-only, with a way to its contact', async () => {
    stubApi({ items: [card({ status: 'approved', contactId: '5' })] });
    renderWithProviders(<BusinessCardsPage />, { route: '/business-cards?open=12' });
    const review = await drawer();

    expect(await review.findByLabelText('Full name')).toHaveAttribute('readonly');
    expect(review.queryByRole('button', { name: 'Save as contact' })).not.toBeInTheDocument();
    expect(review.getByRole('link', { name: 'Open the contact' })).toHaveAttribute('href', '/contacts?open=5');
  });

  it('lets a viewer look at a card but not change it', async () => {
    stubApi({ role: 'viewer' });
    renderWithProviders(<BusinessCardsPage />, { route: '/business-cards?open=12' });
    const review = await drawer();

    expect(await review.findByLabelText('Full name')).toHaveAttribute('readonly');
    expect(review.queryByRole('button', { name: 'Save as contact' })).not.toBeInTheDocument();
    expect(review.queryByRole('button', { name: 'Discard card' })).not.toBeInTheDocument();
  });

  it('says so when the photo cannot be loaded, and still shows the details', async () => {
    cards.image.mockRejectedValue(new ApiError('Not found', { status: 404 }));
    renderWithProviders(<BusinessCardsPage />, { route: '/business-cards?open=12' });
    const review = await drawer();
    expect(await review.findByText('The photo is not available')).toBeInTheDocument();
    expect(review.getByLabelText('Full name')).toHaveValue('Arun Kumar');
  });

  it('shows the Front/Back switch only for a two-sided card, and loads the side that is picked', async () => {
    stubApi({ items: [card({ backImageFileId: '8' })] });
    renderWithProviders(<BusinessCardsPage />, { route: '/business-cards?open=12' });
    const review = await drawer();
    await review.findByLabelText('Full name');

    await waitFor(() => expect(cards.image).toHaveBeenCalledWith('1', '12', 'front', expect.anything()));
    expect(review.getByAltText('The front of the scanned business card')).toBeInTheDocument();
    await userEvent.click(review.getByText('Back'));
    await waitFor(() => expect(cards.image).toHaveBeenCalledWith('1', '12', 'back', expect.anything()));
    expect(await review.findByAltText('The back of the scanned business card')).toBeInTheDocument();
  });

  it('has no Front/Back switch for a one-sided card', async () => {
    renderWithProviders(<BusinessCardsPage />, { route: '/business-cards?open=12' });
    const review = await drawer();
    await review.findByLabelText('Full name');
    expect(review.queryByLabelText('Which side of the card')).not.toBeInTheDocument();
  });
});
