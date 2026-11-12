import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canvasToFile, captureFrame, cameraSupport, describeCameraError, listCameras, openCamera, setTorch, stopStream, torchSupported } from './camera';

const domError = (name: string) => Object.assign(new Error(name), { name });

function stubMediaDevices(devices: Partial<MediaDevices>) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices });
}

beforeEach(() => {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
});
afterEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
});

describe('cameraSupport', () => {
  it('is ok when the page is secure and the browser can open a camera', () => {
    stubMediaDevices({ getUserMedia: vi.fn() });
    expect(cameraSupport()).toBe('ok');
  });

  it('says "insecure" on a page the browser will not give a camera to (plain http on a network address)', () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    stubMediaDevices({ getUserMedia: vi.fn() });
    expect(cameraSupport()).toBe('insecure');
  });

  it('says "unsupported" when the browser has no camera API', () => {
    expect(cameraSupport()).toBe('unsupported');
  });
});

describe('openCamera', () => {
  it('asks for the rear camera at a high resolution, with no microphone', async () => {
    const stream = {} as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    stubMediaDevices({ getUserMedia });

    expect(await openCamera()).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  });

  it('asks for exactly the chosen camera', async () => {
    const getUserMedia = vi.fn().mockResolvedValue({});
    stubMediaDevices({ getUserMedia });
    await openCamera('cam-2');
    expect(getUserMedia.mock.calls[0]?.[0].video).toMatchObject({ deviceId: { exact: 'cam-2' } });
  });

  it('falls back to the default camera when the chosen one has gone away', async () => {
    const getUserMedia = vi.fn().mockRejectedValueOnce(domError('OverconstrainedError')).mockResolvedValueOnce({});
    stubMediaDevices({ getUserMedia });
    await openCamera('unplugged');
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[1]?.[0].video).toMatchObject({ facingMode: { ideal: 'environment' } });
  });

  it('passes on any other failure (e.g. permission denied) instead of hiding it', async () => {
    stubMediaDevices({ getUserMedia: vi.fn().mockRejectedValue(domError('NotAllowedError')) });
    await expect(openCamera('cam-1')).rejects.toMatchObject({ name: 'NotAllowedError' });
  });
});

describe('listCameras / stopStream', () => {
  it('lists only the cameras, not microphones or speakers', async () => {
    stubMediaDevices({
      enumerateDevices: vi.fn().mockResolvedValue([
        { kind: 'audioinput', deviceId: 'mic' },
        { kind: 'videoinput', deviceId: 'cam-1', label: 'Back camera' },
        { kind: 'audiooutput', deviceId: 'spk' },
      ]),
    });
    expect((await listCameras()).map((device) => device.deviceId)).toEqual(['cam-1']);
  });

  it('switches every track off, and is safe with nothing', () => {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    stopStream({ getTracks: () => tracks } as unknown as MediaStream);
    expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    expect(() => stopStream(null)).not.toThrow();
  });
});

describe('describeCameraError', () => {
  it.each([
    ['NotAllowedError', /blocked/],
    ['SecurityError', /blocked/],
    ['NotFoundError', /No camera/],
    ['OverconstrainedError', /No camera/],
    ['NotReadableError', /busy/],
    ['SomethingElse', /could not be started/],
  ])('%s -> %s', (name, message) => {
    expect(describeCameraError(domError(name))).toMatch(message);
  });

  it('copes with a thrown value that is not an error', () => {
    expect(describeCameraError('boom')).toMatch(/could not be started/);
    expect(describeCameraError(null)).toMatch(/could not be started/);
  });
});

describe('torch', () => {
  it('is offered only when the camera reports it', () => {
    expect(torchSupported({ getCapabilities: () => ({ torch: true }) } as unknown as MediaStreamTrack)).toBe(true);
    expect(torchSupported({ getCapabilities: () => ({}) } as unknown as MediaStreamTrack)).toBe(false);
    expect(torchSupported({} as MediaStreamTrack)).toBe(false);
    expect(torchSupported(undefined)).toBe(false);
  });

  it('is switched with an advanced constraint', async () => {
    const applyConstraints = vi.fn().mockResolvedValue(undefined);
    await setTorch({ applyConstraints } as unknown as MediaStreamTrack, true);
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
  });
});

describe('captureFrame / canvasToFile', () => {
  const fakeCanvas = (blob: Blob | null = new Blob(['jpeg'], { type: 'image/jpeg' })) => {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob: vi.fn((callback: (b: Blob | null) => void) => callback(blob)),
    };
    return { canvas: canvas as unknown as HTMLCanvasElement, drawImage, raw: canvas };
  };
  const video = (width: number, height: number) => ({ videoWidth: width, videoHeight: height }) as HTMLVideoElement;

  it('draws the current picture at the camera’s full size and returns it as a JPEG file', async () => {
    const { canvas, drawImage, raw } = fakeCanvas();
    const source = video(1920, 1080);

    const file = await captureFrame(source, () => canvas);

    expect(raw.width).toBe(1920);
    expect(raw.height).toBe(1080);
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 1920, 1080);
    expect(raw.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92);
    expect(file.type).toBe('image/jpeg');
    expect(file.name).toBe('card.jpg');
  });

  it('refuses while the camera has not produced a picture yet', async () => {
    await expect(captureFrame(video(0, 0), () => fakeCanvas().canvas)).rejects.toThrow(/not ready/);
  });

  it('says so when the browser cannot draw', async () => {
    const { canvas, raw } = fakeCanvas();
    raw.getContext.mockReturnValue(null as never);
    await expect(captureFrame(video(100, 100), () => canvas)).rejects.toThrow(/could not be taken/);
  });

  it('says so when the picture cannot be saved', async () => {
    await expect(canvasToFile(fakeCanvas(null).canvas, 'x.jpg')).rejects.toThrow(/could not be saved/);
  });
});
