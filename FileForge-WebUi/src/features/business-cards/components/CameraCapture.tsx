import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Alert, Box, Button, Group, Loader, Select, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconBulb, IconBulbOff, IconCamera, IconPhoto, IconRefresh } from '@tabler/icons-react';

import {
  cameraSupport,
  captureFrame,
  describeCameraError,
  listCameras,
  openCamera,
  setTorch,
  stopStream,
  torchSupported,
} from '../camera';
import { CARD_IMAGE_ACCEPT, MAX_CARD_IMAGE_BYTES } from '../types';
import { checkCardImage } from '../utils';

interface CameraCaptureProps {
  /** A picture was taken (or a photo chosen). It is handed over uncropped. */
  onShot: (file: File) => void;
  /** What is being photographed, e.g. "front of card 2". */
  subject: string;
}

const UNAVAILABLE: Record<'insecure' | 'unsupported', string> = {
  insecure:
    'The camera only works on a secure page (https, or localhost). Open the app that way, or choose a photo from your device instead.',
  unsupported: 'This browser cannot open the camera. Choose a photo from your device instead.',
};

/**
 * A live camera view with a capture button. It prefers the rear camera, lets the user pick another one, offers the light on
 * phones that have one, and always lets them choose an existing photo instead. The camera is switched off the moment this
 * is closed (or another camera is chosen), so the light never stays on.
 */
export function CameraCapture({ onShot, subject }: CameraCaptureProps) {
  const [support] = useState(cameraSupport); // decided once: it cannot change while the page is open
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<'starting' | 'live' | 'error'>('starting');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string | undefined>(undefined);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [canTorch, setCanTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [taking, setTaking] = useState(false);

  useEffect(() => {
    if (support !== 'ok') return;
    let cancelled = false;

    openCamera(cameraId)
      .then(async (opened) => {
        if (cancelled) {
          stopStream(opened);
          return;
        }
        stream.current = opened;
        if (video.current) video.current.srcObject = opened;
        const track = opened.getVideoTracks()[0];
        setActiveId(track?.getSettings?.().deviceId ?? null);
        setCanTorch(torchSupported(track));
        setTorchOn(false);
        setPhase('live');
        // Names of the cameras are only known after the user has allowed access, so the list is read now.
        const found = await listCameras().catch(() => []);
        if (!cancelled) setCameras(found);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(describeCameraError(cause));
        setPhase('error');
      });

    return () => {
      cancelled = true;
      stopStream(stream.current);
      stream.current = null;
    };
  }, [support, cameraId, attempt]);

  const retry = () => {
    setError(null);
    setPhase('starting');
    setAttempt((n) => n + 1);
  };

  const chooseCamera = (id: string | null) => {
    if (!id || id === activeId) return;
    setNotice(null);
    setPhase('starting');
    setCameraId(id);
  };

  const toggleTorch = async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await setTorch(track, !torchOn);
      setTorchOn((on) => !on);
    } catch {
      setNotice('This camera could not switch its light.');
    }
  };

  const take = async () => {
    if (!video.current) return;
    setNotice(null);
    setTaking(true);
    try {
      onShot(await captureFrame(video.current));
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'The photo could not be taken.');
    } finally {
      setTaking(false);
    }
  };

  const choosePhoto = (file: File | undefined) => {
    if (picker.current) picker.current.value = ''; // the same photo can be chosen again
    if (!file) return;
    const problem = checkCardImage(file, MAX_CARD_IMAGE_BYTES);
    if (problem) setNotice(problem);
    else onShot(file);
  };

  const blocked = support !== 'ok' ? UNAVAILABLE[support] : null;
  const message = blocked ?? error;

  return (
    <Stack gap="sm">
      {message ? (
        <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="The camera is not available" role="alert">
          {message}
        </Alert>
      ) : (
        <Box pos="relative" bg="black" style={{ borderRadius: 'var(--mantine-radius-md)', overflow: 'hidden' }}>
          <video
            ref={video}
            autoPlay
            playsInline
            muted
            aria-label={`Camera view: ${subject}`}
            style={{ display: 'block', width: '100%', maxHeight: 440, objectFit: 'contain' }}
          />
          {/* A card-shaped frame, so the card is held square and fills the picture. */}
          <Box
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              margin: 'auto',
              width: '86%',
              maxHeight: '86%',
              aspectRatio: '1.75 / 1',
              border: '2px dashed rgba(255,255,255,0.75)',
              borderRadius: 8,
              pointerEvents: 'none',
            }}
          />
          {phase === 'starting' && (
            <Group justify="center" pos="absolute" inset={0} bg="rgba(0,0,0,0.5)" data-testid="camera-starting">
              <Loader color="white" size="sm" />
              <Text c="white" size="sm">
                Starting the camera…
              </Text>
            </Group>
          )}
        </Box>
      )}

      {notice && (
        <Alert color="red" role="alert">
          {notice}
        </Alert>
      )}

      {!message && (
        <Text size="xs" c="dimmed">
          Hold the {subject} flat, fill the frame, and use good light. Avoid glare and shadows.
        </Text>
      )}

      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Group gap="xs" align="flex-end">
          {cameras.length > 1 && (
            <Select
              label="Camera"
              size="xs"
              allowDeselect={false}
              value={activeId}
              data={cameras.map((camera, index) => ({ value: camera.deviceId, label: camera.label || `Camera ${index + 1}` }))}
              onChange={chooseCamera}
              w={220}
            />
          )}
          {canTorch && (
            <ActionIcon
              variant={torchOn ? 'filled' : 'default'}
              size="lg"
              onClick={toggleTorch}
              aria-label={torchOn ? 'Turn the light off' : 'Turn the light on'}
              aria-pressed={torchOn}
            >
              {torchOn ? <IconBulb size={18} /> : <IconBulbOff size={18} />}
            </ActionIcon>
          )}
          {phase === 'error' && (
            <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={retry}>
              Try the camera again
            </Button>
          )}
        </Group>

        <Group gap="xs">
          <Button variant="default" leftSection={<IconPhoto size={16} />} onClick={() => picker.current?.click()}>
            Choose a photo
          </Button>
          {!message && (
            <Button leftSection={<IconCamera size={18} />} onClick={take} disabled={phase !== 'live'} loading={taking}>
              Take photo
            </Button>
          )}
        </Group>
      </Group>

      <input
        ref={picker}
        type="file"
        accept={CARD_IMAGE_ACCEPT}
        hidden
        data-testid="camera-file-input"
        onChange={(event) => choosePhoto(event.target.files?.[0])}
      />
    </Stack>
  );
}
