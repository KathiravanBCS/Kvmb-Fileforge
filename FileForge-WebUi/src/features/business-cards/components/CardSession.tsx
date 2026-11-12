import { useState } from 'react';
import { Badge, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconCheck, IconPlus } from '@tabler/icons-react';

import { CameraCapture } from './CameraCapture';
import { CardCropper } from './CardCropper';
import { PhotoThumb } from './PhotoThumb';

export interface CapturedCard {
  front: File;
  back?: File;
}

interface CardSessionProps {
  opened: boolean;
  onClose: () => void;
  /** A card is complete (its front, and its back if one was taken). */
  onAddCard: (card: CapturedCard) => void;
  /** How many cards are already waiting to be scanned, so the next one is numbered after them. */
  queuedCount: number;
  /** When set, the session takes only the BACK of that card and closes. */
  backOf?: { label: string; onBack: (file: File) => void } | null;
}

/**
 * The guided way to capture cards: take a photo, crop it, then choose "add the back", "next card" or "finish". Cards are added
 * one after another without leaving this window. Nothing is uploaded here: finished cards go to the queue on the page.
 */
export function CardSession({ opened, onClose, onAddCard, queuedCount, backOf }: CardSessionProps) {
  const small = useMediaQuery('(max-width: 48em)');
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="lg"
      fullScreen={small}
      closeOnClickOutside={false}
      title={backOf ? `Back of ${backOf.label}` : 'Scan business cards'}
    >
      {/* Unmounted when closed, so every opening starts clean and the camera is switched off. */}
      <SessionBody onClose={onClose} onAddCard={onAddCard} queuedCount={queuedCount} backOf={backOf ?? null} />
    </Modal>
  );
}

type Side = 'front' | 'back';
type Stage = 'capture' | 'crop' | 'decide';

function SessionBody({ onClose, onAddCard, queuedCount, backOf }: Omit<CardSessionProps, 'opened'> & { backOf: CardSessionProps['backOf'] }) {
  const [side, setSide] = useState<Side>(backOf ? 'back' : 'front');
  const [stage, setStage] = useState<Stage>('capture');
  const [shot, setShot] = useState<File | null>(null); // taken, waiting to be cropped
  const [front, setFront] = useState<File | null>(null); // cropped, waiting for "add the back?"

  const number = queuedCount + 1;
  const subject = backOf ? `back of ${backOf.label}` : `${side} of card ${number}`;

  const startNextCard = () => {
    setSide('front');
    setStage('capture');
    setShot(null);
    setFront(null);
  };

  const onCropped = (file: File) => {
    setShot(null);
    if (backOf) {
      backOf.onBack(file);
      onClose();
    } else if (side === 'front') {
      setFront(file);
      setStage('decide');
    } else if (front) {
      onAddCard({ front, back: file });
      startNextCard();
    }
  };

  const saveFront = (thenClose: boolean) => {
    if (!front) return;
    onAddCard({ front });
    if (thenClose) onClose();
    else startNextCard();
  };

  return (
    <Stack gap="md">
      <Group justify="space-between">
        {!backOf && (
          <Badge variant="light" size="lg">
            Card {number} · {side === 'front' ? 'Front' : 'Back'}
          </Badge>
        )}
        <Text size="sm" c="dimmed">
          {queuedCount === 0 ? 'No cards added yet' : `${queuedCount} ${queuedCount === 1 ? 'card' : 'cards'} ready to scan`}
        </Text>
      </Group>

      {stage === 'capture' && (
        <>
          <CameraCapture
            subject={subject}
            onShot={(file) => {
              setShot(file);
              setStage('crop');
            }}
          />
          <Group justify="space-between">
            {!backOf && side === 'back' && front ? (
              <Button variant="subtle" onClick={() => saveFront(false)}>
                Skip the back
              </Button>
            ) : (
              <span />
            )}
            <Button variant="default" onClick={onClose}>
              {backOf ? 'Cancel' : 'Done'}
            </Button>
          </Group>
        </>
      )}

      {stage === 'crop' && shot && (
        <CardCropper
          file={shot}
          useLabel={`Use ${side === 'front' && !backOf ? 'front' : 'back'}`}
          onUse={onCropped}
          onRetake={() => {
            setShot(null);
            setStage('capture');
          }}
        />
      )}

      {stage === 'decide' && front && (
        <Stack gap="md" align="flex-start">
          <Group gap="sm">
            <IconCheck size={18} color="var(--mantine-color-green-6)" aria-hidden />
            <Text fw={500}>Front of card {number} is ready.</Text>
          </Group>
          <PhotoThumb file={front} alt={`Front of card ${number}`} height={110} />
          <Text size="sm" c="dimmed">
            Does the back have details too (an address, another language, a website)? Add it so everything is read together.
          </Text>
          <Group>
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => {
                setSide('back');
                setStage('capture');
              }}
            >
              Add the back
            </Button>
            <Button variant="default" onClick={() => saveFront(false)}>
              No back, next card
            </Button>
            <Button variant="subtle" onClick={() => saveFront(true)}>
              No back, finish
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
