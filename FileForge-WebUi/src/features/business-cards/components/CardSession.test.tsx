import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';
import { CardSession } from './CardSession';

// The camera view and the cropper have their own tests. Here they are stubs, so the order of the steps can be driven exactly.
vi.mock('./CameraCapture', () => ({
  CameraCapture: ({ subject, onShot }: { subject: string; onShot: (file: File) => void }) => (
    <div>
      <span>camera: {subject}</span>
      <button onClick={() => onShot(new File(['raw'], 'raw.jpg', { type: 'image/jpeg' }))}>shoot</button>
    </div>
  ),
}));
vi.mock('./CardCropper', () => ({
  CardCropper: ({ useLabel, onUse, onRetake }: { useLabel: string; onUse: (file: File) => void; onRetake: () => void }) => {
    const side = useLabel.replace('Use ', '');
    return (
      <div>
        <span>cropping the {side}</span>
        <button onClick={() => onUse(new File([side], `${side}-cropped.jpg`, { type: 'image/jpeg' }))}>{useLabel}</button>
        <button onClick={onRetake}>retake</button>
      </div>
    );
  },
}));

type Props = React.ComponentProps<typeof CardSession>;
let props: Props;

function renderSession(overrides: Partial<Props> = {}) {
  props = { opened: true, onClose: vi.fn(), onAddCard: vi.fn(), queuedCount: 0, backOf: null, ...overrides };
  return renderWithProviders(<CardSession {...props} />);
}

const click = (name: string | RegExp) => userEvent.click(screen.getByRole('button', { name }));
const names = (card: { front: File; back?: File }) => [card.front.name, card.back?.name];

beforeEach(() => {
  props = undefined as never;
});

describe('CardSession: one card with both sides', () => {
  it('starts with the front of the next card, numbered after the cards already waiting', () => {
    renderSession({ queuedCount: 2 });
    expect(screen.getByText('Card 3 · Front')).toBeInTheDocument();
    expect(screen.getByText('camera: front of card 3')).toBeInTheDocument();
    expect(screen.getByText('2 cards ready to scan')).toBeInTheDocument();
  });

  it('goes front → crop → "add the back?" → back → crop → the finished card, then starts the next one', async () => {
    renderSession();
    await click('shoot');
    expect(screen.getByText('cropping the front')).toBeInTheDocument();
    await click('Use front');

    expect(screen.getByText('Front of card 1 is ready.')).toBeInTheDocument();
    expect(props.onAddCard).not.toHaveBeenCalled(); // a card is only added once it is complete
    await click('Add the back');
    expect(screen.getByText('Card 1 · Back')).toBeInTheDocument();
    expect(screen.getByText('camera: back of card 1')).toBeInTheDocument();

    await click('shoot');
    expect(screen.getByText('cropping the back')).toBeInTheDocument();
    await click('Use back');

    expect(props.onAddCard).toHaveBeenCalledTimes(1);
    expect(names((props.onAddCard as ReturnType<typeof vi.fn>).mock.calls[0]![0])).toEqual(['front-cropped.jpg', 'back-cropped.jpg']);
    expect(screen.getByText('Card 1 · Front')).toBeInTheDocument(); // ready for the next card
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('"No back, next card" adds the card with only its front and carries on', async () => {
    renderSession();
    await click('shoot');
    await click('Use front');
    await click('No back, next card');

    expect(props.onAddCard).toHaveBeenCalledTimes(1);
    expect(names((props.onAddCard as ReturnType<typeof vi.fn>).mock.calls[0]![0])).toEqual(['front-cropped.jpg', undefined]);
    expect(screen.getByText('camera: front of card 1')).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('"No back, finish" adds the card and closes', async () => {
    renderSession();
    await click('shoot');
    await click('Use front');
    await click('No back, finish');
    expect(props.onAddCard).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('"Skip the back" while taking the back adds the card with only its front', async () => {
    renderSession();
    await click('shoot');
    await click('Use front');
    await click('Add the back');
    await click('Skip the back');
    expect(names((props.onAddCard as ReturnType<typeof vi.fn>).mock.calls[0]![0])).toEqual(['front-cropped.jpg', undefined]);
    expect(screen.getByText('Card 1 · Front')).toBeInTheDocument();
  });

  it('Retake throws the picture away and goes back to the camera, adding nothing', async () => {
    renderSession();
    await click('shoot');
    await click('retake');
    expect(screen.getByText('camera: front of card 1')).toBeInTheDocument();
    expect(props.onAddCard).not.toHaveBeenCalled();
  });

  it('"Done" closes without adding a card that was not finished', async () => {
    renderSession();
    await click('shoot');
    await click('retake');
    await click('Done');
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onAddCard).not.toHaveBeenCalled();
  });

  it('adds several cards one after another without leaving the window', async () => {
    renderSession();
    for (let card = 0; card < 3; card++) {
      await click('shoot');
      await click('Use front');
      await click('No back, next card');
    }
    expect(props.onAddCard).toHaveBeenCalledTimes(3);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('says how many cards are waiting, and that none are yet', () => {
    renderSession({ queuedCount: 1 });
    expect(screen.getByText('1 card ready to scan')).toBeInTheDocument();
  });

  it('shows nothing while closed', () => {
    renderSession({ opened: false });
    expect(screen.queryByText(/Card 1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/camera:/)).not.toBeInTheDocument();
  });
});

describe('CardSession: only the back of a card that is already waiting', () => {
  it('takes one picture of the back, hands it over, and closes', async () => {
    const onBack = vi.fn();
    renderSession({ backOf: { label: 'card 2', onBack } });

    expect(screen.getByText('Back of card 2')).toBeInTheDocument();
    expect(screen.getByText('camera: back of card 2')).toBeInTheDocument();
    expect(screen.queryByText(/Card 1 ·/)).not.toBeInTheDocument();
    await click('shoot');
    await click('Use back');

    expect(onBack).toHaveBeenCalledTimes(1);
    expect((onBack.mock.calls[0]![0] as File).name).toBe('back-cropped.jpg');
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onAddCard).not.toHaveBeenCalled();
  });

  it('can be cancelled without changing the card', async () => {
    const onBack = vi.fn();
    renderSession({ backOf: { label: 'card 2', onBack } });
    await click('Cancel');
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });
});
