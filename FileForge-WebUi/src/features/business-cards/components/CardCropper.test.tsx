import { forwardRef, useImperativeHandle } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';
import { CardCropper } from './CardCropper';

// cropperjs needs a real layout engine and canvas; here it is replaced by an object with the same methods the screen calls.
const instance = vi.hoisted(() => ({
  setAspectRatio: vi.fn(),
  rotate: vi.fn(),
  reset: vi.fn(),
  getCroppedCanvas: vi.fn(),
}));
vi.mock('react-cropper', () => ({
  Cropper: forwardRef<unknown, { src?: string; alt?: string }>(function FakeCropper(props, ref) {
    useImperativeHandle(ref, () => ({ cropper: instance }));
    return <img alt={props.alt} src={props.src} data-testid="cropper" />;
  }),
}));

const croppedCanvas = (blob: Blob | null = new Blob(['jpeg'], { type: 'image/jpeg' })) => ({
  toBlob: vi.fn((callback: (b: Blob | null) => void) => callback(blob)),
});

const picture = () => new File(['raw'], 'raw.jpg', { type: 'image/jpeg' });

beforeEach(() => {
  for (const fn of Object.values(instance)) fn.mockReset();
  instance.getCroppedCanvas.mockReturnValue(croppedCanvas());
});

function renderCropper(overrides: Partial<React.ComponentProps<typeof CardCropper>> = {}) {
  const props = { file: picture(), useLabel: 'Use front', onUse: vi.fn(), onRetake: vi.fn(), ...overrides };
  renderWithProviders(<CardCropper {...props} />);
  return props;
}

describe('CardCropper', () => {
  it('shows the picture to crop', async () => {
    renderCropper();
    expect(await screen.findByAltText('The photo to crop')).toHaveAttribute('src', expect.stringMatching(/^blob:/));
  });

  it('hands over the cropped picture as a JPEG, cut at a size that is readable but quick to upload', async () => {
    const { onUse } = renderCropper();
    await userEvent.click(await screen.findByRole('button', { name: 'Use front' }));

    await waitFor(() => expect(onUse).toHaveBeenCalledTimes(1));
    expect(instance.getCroppedCanvas).toHaveBeenCalledWith(
      expect.objectContaining({ maxWidth: 2200, maxHeight: 2200, fillColor: '#ffffff', imageSmoothingQuality: 'high' }),
    );
    const file = (onUse as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as File;
    expect(file.type).toBe('image/jpeg');
    expect(file.name).toBe('card.jpg');
  });

  it('uses the label it is given on the button (front or back)', async () => {
    renderCropper({ useLabel: 'Use back' });
    expect(await screen.findByRole('button', { name: 'Use back' })).toBeInTheDocument();
  });

  it('rotates the photo left and right in quarter turns, and can reset', async () => {
    renderCropper();
    await userEvent.click(await screen.findByRole('button', { name: 'Rotate left' }));
    await userEvent.click(screen.getByRole('button', { name: 'Rotate right' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(instance.rotate.mock.calls).toEqual([[-90], [90]]);
    expect(instance.reset).toHaveBeenCalledTimes(1);
  });

  it('changes the shape of the selection: any shape, or a card (wide / tall)', async () => {
    renderCropper();
    await screen.findByAltText('The photo to crop');
    await userEvent.click(screen.getByText('Card (wide)'));
    await userEvent.click(screen.getByText('Card (tall)'));
    await userEvent.click(screen.getByText('Any shape'));

    const ratios = instance.setAspectRatio.mock.calls.map((call) => call[0] as number);
    expect(ratios[0]).toBeCloseTo(85 / 54);
    expect(ratios[1]).toBeCloseTo(54 / 85);
    expect(Number.isNaN(ratios[2])).toBe(true); // NaN is "any shape" to cropperjs
  });

  it('throws the picture away on Retake, without cropping anything', async () => {
    const { onRetake, onUse } = renderCropper();
    await userEvent.click(await screen.findByRole('button', { name: /Retake/ }));
    expect(onRetake).toHaveBeenCalledTimes(1);
    expect(onUse).not.toHaveBeenCalled();
    expect(instance.getCroppedCanvas).not.toHaveBeenCalled();
  });

  it('says so when nothing is selected, and hands nothing over', async () => {
    instance.getCroppedCanvas.mockReturnValue(null);
    const { onUse } = renderCropper();
    await userEvent.click(await screen.findByRole('button', { name: 'Use front' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Select the card first.');
    expect(onUse).not.toHaveBeenCalled();
  });

  it('says so when the cropped picture cannot be saved, and can be tried again', async () => {
    instance.getCroppedCanvas.mockReturnValueOnce(croppedCanvas(null));
    const { onUse } = renderCropper();
    await userEvent.click(await screen.findByRole('button', { name: 'Use front' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
    expect(onUse).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Use front' }));
    await waitFor(() => expect(onUse).toHaveBeenCalledTimes(1));
  });
});
