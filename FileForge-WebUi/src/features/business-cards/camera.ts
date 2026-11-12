/**
 * Browser camera helpers for scanning cards. Everything that touches `navigator.mediaDevices` or a canvas lives here, so the
 * screens stay plain and the browser-only parts can be replaced in tests.
 */

export type CameraSupport = 'ok' | 'insecure' | 'unsupported';

/**
 * Can this page open a camera at all? Browsers only offer one on a secure page (https, or localhost), so a phone that opens the
 * app over plain http on a local address gets "insecure" here, not a camera.
 */
export function cameraSupport(): CameraSupport {
  if (typeof window !== 'undefined' && window.isSecureContext === false) return 'insecure';
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return 'unsupported';
  return 'ok';
}

/** The DOM error's `name` (DOMException is not always an Error subclass), or ''. */
const nameOf = (error: unknown): string =>
  typeof (error as { name?: unknown } | null)?.name === 'string' ? (error as { name: string }).name : '';

/**
 * Opens a camera. Without a chosen device it asks for the rear ("environment") camera, which is what a phone should use for a
 * card. If a chosen device has disappeared (unplugged), it falls back to the default instead of failing.
 */
export async function openCamera(deviceId?: string): Promise<MediaStream> {
  const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  const video: MediaTrackConstraints = deviceId
    ? { deviceId: { exact: deviceId }, ...size }
    : { facingMode: { ideal: 'environment' }, ...size };
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (error) {
    if (deviceId && nameOf(error) === 'OverconstrainedError') return openCamera();
    throw error;
  }
}

/** The cameras of this device. Their names are only known once the user has allowed camera access. */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  return (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
}

/** Switches the camera off (the light goes out). Safe to call with nothing. */
export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Plain words for why a camera did not start. */
export function describeCameraError(error: unknown): string {
  switch (nameOf(error)) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Camera access is blocked. Allow the camera for this site in your browser settings, then try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'The camera is busy or not working. Close other apps that use it and try again.';
    default:
      return 'The camera could not be started.';
  }
}

/** Does this camera have a flash/torch the page may switch on? (Mostly phones' rear cameras.) */
export function torchSupported(track: MediaStreamTrack | undefined): boolean {
  const capabilities = track?.getCapabilities?.() as { torch?: boolean } | undefined;
  return capabilities?.torch === true;
}

export async function setTorch(track: MediaStreamTrack, on: boolean): Promise<void> {
  await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
}

/** How well the saved JPEG is kept: high, because small print on a card has to stay readable. */
const JPEG_QUALITY = 0.92;

/** A canvas as a JPEG file. */
export function canvasToFile(canvas: HTMLCanvasElement, name: string, quality = JPEG_QUALITY): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(new File([blob], name, { type: 'image/jpeg' })) : reject(new Error('The photo could not be saved.'))),
      'image/jpeg',
      quality,
    );
  });
}

/** Takes the picture that is on screen right now, at the camera's full resolution. */
export function captureFrame(video: HTMLVideoElement, createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')): Promise<File> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return Promise.reject(new Error('The camera is not ready yet. Wait a moment and try again.'));

  const canvas = createCanvas();
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('The photo could not be taken in this browser.'));
  context.drawImage(video, 0, 0, width, height);
  return canvasToFile(canvas, 'card.jpg');
}
