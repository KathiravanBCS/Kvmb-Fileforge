import { useState } from 'react';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Drawer,
  Group,
  Image,
  Loader,
  Modal,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';

import { useObjectUrl } from '@/features/central-storage/hooks/useObjectUrl';
import { useBusinessCardImage } from '../api/useBusinessCardImage';
import { useGetBusinessCard } from '../api/useGetBusinessCard';
import { useReviewBusinessCard } from '../api/useReviewBusinessCard';
import type { BusinessCard } from '../types';
import {
  cardTitle,
  hasContactInformation,
  isDirty,
  scanErrorMessage,
  STATUS_BADGE,
  toDraft,
  toPatch,
  validateDraft,
  type CardDraft,
  type CardDraftKey,
} from '../utils';
import { CardForm } from './CardForm';

interface CardReviewDrawerProps {
  /** The scan to review, or null when closed. */
  cardId: string | null;
  onClose: () => void;
  /** May this user change cards (viewers only look). */
  canEdit: boolean;
}

/** Photo on one side, the fields read from it on the other: correct them, then save it as a contact or discard it. */
export function CardReviewDrawer({ cardId, onClose, canEdit }: CardReviewDrawerProps) {
  const card = useGetBusinessCard(cardId);

  return (
    <Drawer opened={cardId !== null} onClose={onClose} position="right" size="xl" title="Review business card">
      {card.isPending && cardId !== null && (
        <Group justify="center" p="xl">
          <Loader />
        </Group>
      )}
      {card.isError && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} title="This card could not be opened">
          {scanErrorMessage(card.error)}
        </Alert>
      )}
      {/* Keyed by id: switching to another card starts with that card's own form, never the previous one's edits. */}
      {card.data && <ReviewBody key={card.data.id} card={card.data} onClose={onClose} canEdit={canEdit} />}
    </Drawer>
  );
}

function ReviewBody({ card, onClose, canEdit }: { card: BusinessCard; onClose: () => void; canEdit: boolean }) {
  const [draft, setDraft] = useState<CardDraft>(() => toDraft(card.data));
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const [working, setWorking] = useState<'save' | 'approve' | 'reject' | null>(null);
  const { update, approve, reject } = useReviewBusinessCard();

  // A card with a back has two photos: show the one the user picks (the front first).
  const [side, setSide] = useState<'front' | 'back'>('front');
  const image = useBusinessCardImage(card.id, side);
  const imageUrl = useObjectUrl(image.data);

  const pending = card.status === 'pending';
  const editable = pending && canEdit;
  const errors = showErrors ? validateDraft(draft) : {};
  const dirty = isDirty(draft, card.data);
  const busy = working !== null;
  const readable = hasContactInformation(draft);
  const badge = STATUS_BADGE[card.status];

  const change = (key: CardDraftKey, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  /** Saves the form if it changed. Returns false (and shows why) when the form is not valid. */
  const saveIfChanged = async (): Promise<boolean> => {
    if (Object.keys(validateDraft(draft)).length > 0) {
      setShowErrors(true);
      return false;
    }
    if (dirty) await update.mutateAsync({ id: card.id, patch: toPatch(draft) });
    return true;
  };

  const run = async (kind: 'save' | 'approve' | 'reject', action: () => Promise<void>) => {
    setError(null);
    setWorking(kind);
    try {
      await action();
    } catch (cause) {
      setError(scanErrorMessage(cause));
    } finally {
      setWorking(null);
    }
  };

  const onSave = () =>
    run('save', async () => {
      if (await saveIfChanged()) notifications.show({ color: 'green', title: 'Changes saved', message: 'The corrections were saved.' });
    });

  const onApprove = () =>
    run('approve', async () => {
      if (!(await saveIfChanged())) return;
      await approve.mutateAsync(card.id);
      notifications.show({
        color: 'green',
        icon: <IconCheck size={18} />,
        title: 'Contact saved',
        message: `${draft.fullName.trim() || draft.companyName.trim() || draft.email.trim() || 'The contact'} is now in your contacts.`,
      });
      onClose();
    });

  const onReject = () =>
    run('reject', async () => {
      await reject.mutateAsync(card.id);
      setConfirmReject(false);
      notifications.show({ title: 'Card discarded', message: 'No contact was created.' });
      onClose();
    });

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Text fw={600}>{cardTitle(card.data)}</Text>
          <Text size="xs" c="dimmed">
            Scanned {dayjs(card.createdAt).format('D MMM YYYY, HH:mm')}
          </Text>
        </div>
        <Badge color={badge.color} variant="light">
          {badge.label}
        </Badge>
      </Group>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg" verticalSpacing="md">
        <Stack gap="xs">
          {card.backImageFileId && (
            <SegmentedControl
              size="xs"
              aria-label="Which side of the card"
              value={side}
              onChange={(value) => setSide(value as 'front' | 'back')}
              data={[
                { value: 'front', label: 'Front' },
                { value: 'back', label: 'Back' },
              ]}
            />
          )}
          {imageUrl ? (
            <Image src={imageUrl} alt={`The ${side} of the scanned business card`} radius="md" fit="contain" mah={420} />
          ) : image.isError ? (
            <Alert color="yellow" title="The photo is not available">
              The card photo could not be loaded. You can still review the details.
            </Alert>
          ) : (
            <Skeleton h={220} radius="md" aria-label="Loading the card photo" />
          )}
        </Stack>

        <Stack gap="md">
          {editable && !readable && (
            <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Nothing could be read from this card">
              Type in at least a name, company, e-mail or phone number to save it as a contact.
            </Alert>
          )}
          <CardForm draft={draft} errors={errors} onChange={change} readOnly={!editable} />
        </Stack>
      </SimpleGrid>

      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} title="That did not work" role="alert">
          {error}
        </Alert>
      )}

      {card.status === 'approved' && card.contactId && (
        <Text size="sm">
          Saved as a contact.{' '}
          <Anchor component={Link} to={`/contacts?open=${card.contactId}`}>
            Open the contact
          </Anchor>
        </Text>
      )}

      {editable && (
        <Group justify="space-between">
          <Button variant="subtle" color="red" onClick={() => setConfirmReject(true)} disabled={busy}>
            Discard card
          </Button>
          <Group>
            <Button variant="default" onClick={onSave} disabled={!dirty || busy} loading={working === 'save'}>
              Save changes
            </Button>
            <Button onClick={onApprove} disabled={!readable || busy} loading={working === 'approve'}>
              Save as contact
            </Button>
          </Group>
        </Group>
      )}

      <Modal opened={confirmReject} onClose={() => setConfirmReject(false)} title="Discard this card?" centered>
        <Stack>
          <Text size="sm">No contact will be created. The photo stays in your files.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmReject(false)}>
              Keep reviewing
            </Button>
            <Button color="red" onClick={onReject} loading={working === 'reject'}>
              Discard
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
