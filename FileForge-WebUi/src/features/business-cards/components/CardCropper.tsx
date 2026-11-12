import { useRef, useState } from 'react';
import { Alert, Button, Group, SegmentedControl, Skeleton, Stack, Text } from '@mantine/core';
import { IconCrop, IconRefresh, IconRotate, IconRotateClockwise } from '@tabler/icons-react';
import { Cropper, type ReactCropperElement } from 'react-cropper';
import 'cropperjs/dist/cropper.css';

import { useObjectUrl } from '@/features/central-storage/hooks/useObjectUrl';
import { canvasToFile } from '../camera';

interface CardCropperProps {
  /** The picture to crop: a camera shot or a chosen photo. */
  file: File;
  /** The cropped picture, ready to use. */
  onUse: (file: File) => void;
  /** Throw this picture away and take another. */
  onRetake: () => void;
  /** Wording for the "use" button, e.g. "Use front". */
  useLabel: string;
}

type Shape = 'free' | 'landscape' | 'portrait';

/** Width / height of a standard card (85 x 54 mm). NaN means "any shape" to cropperjs. */
const RATIOS: Record<Shape, number> = { free: Number.NaN, landscape: 85 / 54, portrait: 54 / 85 };

/** Cut out the card: drag the corners, rotate if it was shot sideways, then use the result. */
export function CardCropper({ file, onUse, onRetake, useLabel }: CardCropperProps) {
  const url = useObjectUrl(file);
  const cropper = useRef<ReactCropperElement>(null);
  const [shape, setShape] = useState<Shape>('free');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const instance = () => cropper.current?.cropper;

  const changeShape = (next: string) => {
    setShape(next as Shape);
    instance()?.setAspectRatio(RATIOS[next as Shape]);
  };

  const use = async () => {
    const active = instance();
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      // Large enough to read small print, small enough to upload quickly.
      const canvas = active.getCroppedCanvas({
        maxWidth: 2200,
        maxHeight: 2200,
        fillColor: '#ffffff',
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
      });
      if (!canvas) throw new Error('Select the card first.');
      onUse(await canvasToFile(canvas, 'card.jpg', 0.9));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The photo could not be cropped.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Drag the corners so only the card is selected. Rotate it if it is on its side.
      </Text>

      {url ? (
        <Cropper
          ref={cropper}
          src={url}
          alt="The photo to crop"
          style={{ height: 380, width: '100%' }}
          viewMode={1}
          dragMode="move"
          autoCropArea={0.94}
          background={false}
          guides
          responsive
          restore={false}
          checkOrientation
          movable
          zoomable
          rotatable
        />
      ) : (
        <Skeleton h={380} radius="md" aria-label="Loading the photo" />
      )}

      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}

      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <SegmentedControl
            size="xs"
            aria-label="Shape of the selection"
            value={shape}
            onChange={changeShape}
            data={[
              { value: 'free', label: 'Any shape' },
              { value: 'landscape', label: 'Card (wide)' },
              { value: 'portrait', label: 'Card (tall)' },
            ]}
          />
          <Button variant="default" size="xs" leftSection={<IconRotate size={14} />} onClick={() => instance()?.rotate(-90)} aria-label="Rotate left">
            Left
          </Button>
          <Button variant="default" size="xs" leftSection={<IconRotateClockwise size={14} />} onClick={() => instance()?.rotate(90)} aria-label="Rotate right">
            Right
          </Button>
          <Button variant="subtle" size="xs" onClick={() => instance()?.reset()}>
            Reset
          </Button>
        </Group>

        <Group gap="xs">
          <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={onRetake} disabled={busy}>
            Retake
          </Button>
          <Button leftSection={<IconCrop size={16} />} onClick={use} loading={busy} disabled={!url}>
            {useLabel}
          </Button>
        </Group>
      </Group>
    </Stack>
  );
}
