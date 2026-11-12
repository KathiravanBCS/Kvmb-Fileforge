import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';
import * as camera from '../camera';
import { CameraCapture } from './CameraCapture';

// The real helpers for wording and stopping; only what touches the browser's camera and canvas is replaced.
vi.mock('../camera', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../camera')>()),
  cameraSupport: vi.fn(),
  openCamera: vi.fn(),
  listCameras: vi.fn(),
  captureFrame: vi.fn(),
  torchSupported: vi.fn(),
  setTorch: vi.fn(),
}));

const mocked = vi.mocked(camera);
const domError = (name: string) => Object.assign(new Error(name), { name });

function fakeStream(deviceId = 'cam-1') {
  const track = { stop: vi.fn(), getSettings: () => ({ deviceId }) };
  return { stream: { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream, track };
}

const device = (deviceId: string, label: string) => ({ deviceId, label, kind: 'videoinput' }) as MediaDeviceInfo;

beforeEach(() => {
  for (const fn of [mocked.cameraSupport, mocked.openCamera, mocked.listCameras, mocked.captureFrame, mocked.torchSupported, mocked.setTorch]) {
    fn.mockReset();
  }
  mocked.cameraSupport.mockReturnValue('ok');
  mocked.listCameras.mockResolvedValue([]);
  mocked.torchSupported.mockReturnValue(false);
  mocked.openCamera.mockResolvedValue(fakeStream().stream);
});

const photo = (name = 'card.jpg', type = 'image/jpeg') => new File(['x'], name, { type });

describe('CameraCapture: taking a photo', () => {
  it('starts the rear camera, shows it live, and hands over the photo that is taken', async () => {
    const taken = photo('shot.jpg');
    mocked.captureFrame.mockResolvedValue(taken);
    const onShot = vi.fn();
    renderWithProviders(<CameraCapture subject="front of card 1" onShot={onShot} />);

    const view = await screen.findByLabelText('Camera view: front of card 1');
    expect(mocked.openCamera).toHaveBeenCalledWith(undefined);
    const take = screen.getByRole('button', { name: 'Take photo' });
    await waitFor(() => expect(take).toBeEnabled()); // enabled only once the camera is really running
    expect(screen.queryByTestId('camera-starting')).not.toBeInTheDocument();

    await userEvent.click(take);
    await waitFor(() => expect(onShot).toHaveBeenCalledWith(taken));
    expect(mocked.captureFrame).toHaveBeenCalledWith(view);
  });

  it('cannot take a photo before the camera is running', async () => {
    mocked.openCamera.mockReturnValue(new Promise(() => undefined)); // never opens
    renderWithProviders(<CameraCapture subject="front of card 1" onShot={vi.fn()} />);
    expect(await screen.findByTestId('camera-starting')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
  });

  it('says so when the photo cannot be taken, and stays live', async () => {
    mocked.captureFrame.mockRejectedValue(new Error('The camera is not ready yet. Wait a moment and try again.'));
    const onShot = vi.fn();
    renderWithProviders(<CameraCapture subject="front of card 1" onShot={onShot} />);
    const take = await screen.findByRole('button', { name: 'Take photo' });
    await waitFor(() => expect(take).toBeEnabled());
    await userEvent.click(take);

    expect(await screen.findByText(/not ready yet/)).toBeInTheDocument();
    expect(onShot).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
  });
});

describe('CameraCapture: when the camera does not start', () => {
  it('explains a blocked camera and lets the user try again', async () => {
    mocked.openCamera.mockRejectedValueOnce(domError('NotAllowedError'));
    renderWithProviders(<CameraCapture subject="front of card 1" onShot={vi.fn()} />);

    expect(await screen.findByText(/Camera access is blocked/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take photo' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try the camera again' }));
    await waitFor(() => expect(mocked.openCamera).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText('Camera view: front of card 1')).toBeInTheDocument();
    expect(screen.queryByText(/Camera access is blocked/)).not.toBeInTheDocument();
  });

  it.each([
    ['NotFoundError', /No camera was found/],
    ['NotReadableError', /busy or not working/],
  ])('explains %s in plain words', async (name, message) => {
    mocked.openCamera.mockRejectedValue(domError(name));
    renderWithProviders(<CameraCapture subject="front of card 1" onShot={vi.fn()} />);
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('on an insecure page does not even try, and says how to fix it', async () => {
    mocked.cameraSupport.mockReturnValue('insecure');
    renderWithProviders(<CameraCapture subject="front of card 1" onShot={vi.fn()} />);
    expect(await screen.findByText(/secure page \(https, or localhost\)/)).toBeInTheDocument();
    expect(mocked.openCamera).not.toHaveBeenCalled();
  });

  it('in a browser without a camera API says so, and still allows choosing a photo', async () => {
    mocked.cameraSupport.mockReturnValue('unsupported');
    const onShot = vi.fn();
    renderWithProviders(<CameraCapture subject="front of card 1" onShot={onShot} />);
    expect(await screen.findByText(/cannot open the camera/)).toBeInTheDocument();
    expect(mocked.openCamera).not.toHaveBeenCalled();

    const chosen = photo('gallery.png', 'image/png');
    await userEvent.upload(screen.getByTestId('camera-file-input'), chosen, { applyAccept: false });
    expect(onShot).toHaveBeenCalledWith(chosen);
  });
});

describe('CameraCapture: choosing a photo instead', () => {
  it('hands over a valid photo uncropped', async () => {
    const onShot = vi.fn();
    renderWithProviders(<CameraCapture subject="front of card 1" onShot={onShot} />);
    await screen.findByLabelText('Camera view: front of card 1');
    const chosen = photo('gallery.jpg');
    await userEvent.upload(screen.getByTestId('camera-file-input'), chosen, { applyAccept: false });
    expect(onShot).toHaveBeenCalledWith(chosen);
  });

  it('refuses a file that is not a JPG, PNG or WebP photo, and says why', async () => {
    const onShot = vi.fn();
    renderWithProviders(<CameraCapture subject="front of card 1" onShot={onShot} />);
    await screen.findByLabelText('Camera view: front of card 1');
    await userEvent.upload(screen.getByTestId('camera-file-input'), photo('notes.pdf', 'application/pdf'), { applyAccept: false });
    expect(await screen.findByText(/JPG, PNG or WebP photo/)).toBeInTheDocument();
    expect(onShot).not.toHaveBeenCalled();
  });
});

describe('CameraCapture: cameras, light and cleaning up', () => {
  it('offers a choice only when there is more than one camera, and reopens with the one chosen', async () => {
    const first = fakeStream('cam-1');
    const second = fakeStream('cam-2');
    mocked.openCamera.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
    mocked.listCameras.mockResolvedValue([device('cam-1', 'Back camera'), device('cam-2', 'Front camera')]);
    renderWithProviders(<CameraCapture subject="front of card 1" onShot={vi.fn()} />);

    await userEvent.click(await screen.findByRole('combobox', { name: 'Camera' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Front camera' }));

    await waitFor(() => expect(mocked.openCamera).toHaveBeenLastCalledWith('cam-2'));
    expect(first.track.stop).toHaveBeenCalled(); // the previous camera is switched off first
  });

  it('shows no camera choice when there is only one', async () => {
    mocked.listCameras.mockResolvedValue([device('cam-1', 'Only camera')]);
    renderWithProviders(<CameraCapture subject="front of card 1" onShot={vi.fn()} />);
    await screen.findByLabelText('Camera view: front of card 1');
    await waitFor(() => expect(mocked.listCameras).toHaveBeenCalled());
    expect(screen.queryByRole('combobox', { name: 'Camera' })).not.toBeInTheDocument();
  });

  it('offers the light only on a camera that has one, and switches it', async () => {
    mocked.torchSupported.mockReturnValue(true);
    mocked.setTorch.mockResolvedValue(undefined);
    renderWithProviders(<CameraCapture subject="front of card 1" onShot={vi.fn()} />);

    const light = await screen.findByRole('button', { name: 'Turn the light on' });
    await userEvent.click(light);
    await waitFor(() => expect(mocked.setTorch).toHaveBeenCalledWith(expect.anything(), true));
    expect(await screen.findByRole('button', { name: 'Turn the light off' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('has no light button on a camera without one', async () => {
    renderWithProviders(<CameraCapture subject="front of card 1" onShot={vi.fn()} />);
    await screen.findByLabelText('Camera view: front of card 1');
    expect(screen.queryByRole('button', { name: /light/i })).not.toBeInTheDocument();
  });

  it('says so when the light cannot be switched', async () => {
    mocked.torchSupported.mockReturnValue(true);
    mocked.setTorch.mockRejectedValue(new Error('nope'));
    renderWithProviders(<CameraCapture subject="front of card 1" onShot={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Turn the light on' }));
    expect(await screen.findByText(/could not switch its light/)).toBeInTheDocument();
  });

  it('switches the camera OFF when it is closed, so the light never stays on', async () => {
    const opened = fakeStream();
    mocked.openCamera.mockResolvedValue(opened.stream);
    const { unmount } = renderWithProviders(<CameraCapture subject="front of card 1" onShot={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled());
    expect(opened.track.stop).not.toHaveBeenCalled();

    unmount();
    expect(opened.track.stop).toHaveBeenCalledTimes(1);
  });

  it('switches off a camera that finished opening after the window was already closed', async () => {
    const late = fakeStream();
    let release!: (stream: MediaStream) => void;
    mocked.openCamera.mockReturnValue(new Promise<MediaStream>((resolve) => (release = resolve)));
    const { unmount } = renderWithProviders(<CameraCapture subject="front of card 1" onShot={vi.fn()} />);
    await screen.findByTestId('camera-starting');

    unmount();
    release(late.stream);
    await waitFor(() => expect(late.track.stop).toHaveBeenCalledTimes(1));
  });
});
