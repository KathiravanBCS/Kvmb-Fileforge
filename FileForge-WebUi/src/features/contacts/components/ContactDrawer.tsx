import { useState } from 'react';
import { Alert, Anchor, Badge, Button, Divider, Drawer, Group, Loader, Modal, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconBrandGithub, IconBrandLinkedin, IconMail, IconMapPin, IconPhone, IconWorld } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';

import { useContactActions } from '../api/useContactActions';
import { useGetContact } from '../api/useGetContact';
import { REVIEW_STATUSES, type Contact, type ContactUpdate, type ReviewStatus } from '../types';
import { contactErrorMessage, describeLink, formatAddress, isWebUrl, REVIEW_LABELS } from '../utils';

interface ContactDrawerProps {
  contactId: string | null;
  onClose: () => void;
  /** May this user change contacts (viewers only look). */
  canEdit: boolean;
}

export function ContactDrawer({ contactId, onClose, canEdit }: ContactDrawerProps) {
  const contact = useGetContact(contactId);

  return (
    <Drawer opened={contactId !== null} onClose={onClose} position="right" size="lg" title="Contact">
      {contact.isPending && contactId !== null && (
        <Group justify="center" p="xl">
          <Loader />
        </Group>
      )}
      {contact.isError && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} title="This contact could not be opened">
          {contactErrorMessage(contact.error)}
        </Alert>
      )}
      {/* Keyed by id and version, so editing never starts from another contact's (or an older) values. */}
      {contact.data && <ContactBody key={`${contact.data.id}:${contact.data.updatedAt}`} contact={contact.data} onClose={onClose} canEdit={canEdit} />}
    </Drawer>
  );
}

function MethodIcon({ type, label }: { type: string; label: string | null }) {
  if (type === 'email') return <IconMail size={16} aria-hidden />;
  if (type === 'phone') return <IconPhone size={16} aria-hidden />;
  if (label === 'linkedin') return <IconBrandLinkedin size={16} aria-hidden />;
  if (label === 'github') return <IconBrandGithub size={16} aria-hidden />;
  return <IconWorld size={16} aria-hidden />;
}

function MethodValue({ type, value }: { type: string; value: string }) {
  if (type === 'email') return <Anchor href={`mailto:${value}`}>{value}</Anchor>;
  if (type === 'phone') return <Anchor href={`tel:${value.replace(/[^\d+]/g, '')}`}>{value}</Anchor>;
  return isWebUrl(value) ? (
    <Anchor href={value} target="_blank" rel="noopener noreferrer">
      {value}
    </Anchor>
  ) : (
    <Text span>{value}</Text>
  );
}

interface Draft {
  displayName: string;
  organization: string;
  jobTitle: string;
  department: string;
  notes: string;
  reviewStatus: ReviewStatus;
}

const toDraft = (c: Contact): Draft => ({
  displayName: c.displayName,
  organization: c.organization ?? '',
  jobTitle: c.jobTitle ?? '',
  department: c.department ?? '',
  notes: c.notes ?? '',
  reviewStatus: (REVIEW_STATUSES as readonly string[]).includes(c.reviewStatus) ? (c.reviewStatus as ReviewStatus) : 'unreviewed',
});

const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

function ContactBody({ contact, onClose, canEdit }: { contact: Contact; onClose: () => void; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(contact));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { update, remove } = useContactActions();
  const review = REVIEW_LABELS[contact.reviewStatus] ?? { label: contact.reviewStatus, color: 'gray' };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const nameMissing = draft.displayName.trim() === '';

  const onSave = async () => {
    setError(null);
    const patch: ContactUpdate = {
      displayName: draft.displayName.trim(),
      organization: orNull(draft.organization),
      jobTitle: orNull(draft.jobTitle),
      department: orNull(draft.department),
      notes: orNull(draft.notes),
      reviewStatus: draft.reviewStatus,
    };
    try {
      await update.mutateAsync({ id: contact.id, patch });
      notifications.show({ color: 'green', title: 'Contact saved', message: 'The changes were saved.' });
      setEditing(false);
    } catch (cause) {
      setError(contactErrorMessage(cause));
    }
  };

  const onDelete = async () => {
    setError(null);
    try {
      await remove.mutateAsync(contact.id);
      notifications.show({ title: 'Contact deleted', message: `${contact.displayName} was removed from your contacts.` });
      onClose();
    } catch (cause) {
      setConfirmDelete(false);
      setError(contactErrorMessage(cause));
    }
  };

  return (
    <Stack gap="lg">
      {editing ? (
        <Stack gap="md">
          <TextInput label="Name" required value={draft.displayName} error={nameMissing ? 'A name is required.' : undefined} onChange={(e) => set('displayName', e.currentTarget.value)} />
          <TextInput label="Company" value={draft.organization} onChange={(e) => set('organization', e.currentTarget.value)} />
          <Group grow align="flex-start">
            <TextInput label="Job title" value={draft.jobTitle} onChange={(e) => set('jobTitle', e.currentTarget.value)} />
            <TextInput label="Department" value={draft.department} onChange={(e) => set('department', e.currentTarget.value)} />
          </Group>
          <Select
            label="Review status"
            allowDeselect={false}
            value={draft.reviewStatus}
            data={REVIEW_STATUSES.map((s) => ({ value: s, label: REVIEW_LABELS[s]?.label ?? s }))}
            onChange={(value) => value && set('reviewStatus', value as ReviewStatus)}
          />
          <Textarea label="Notes" rows={4} resize="vertical" maxLength={4000} value={draft.notes} onChange={(e) => set('notes', e.currentTarget.value)} />
        </Stack>
      ) : (
        <Stack gap={4}>
          <Group justify="space-between" align="flex-start">
            <Text size="xl" fw={600}>
              {contact.displayName}
            </Text>
            <Badge color={review.color} variant="light">
              {review.label}
            </Badge>
          </Group>
          <Text c="dimmed" size="sm">
            {[contact.jobTitle, contact.department].filter(Boolean).join(' · ') || null}
          </Text>
          {contact.organization && <Text size="sm">{contact.organization}</Text>}
        </Stack>
      )}

      {!editing && (
        <>
          <Divider label="Contact details" labelPosition="left" />
          {contact.methods.length === 0 && contact.addresses.length === 0 ? (
            <Text size="sm" c="dimmed">
              No e-mail, phone or address saved.
            </Text>
          ) : (
            <Stack gap="xs">
              {contact.methods.map((method) => (
                <Group key={method.id} gap="xs" wrap="nowrap" align="flex-start">
                  <MethodIcon type={method.type} label={method.label} />
                  <Text size="sm" style={{ wordBreak: 'break-word' }}>
                    <MethodValue type={method.type} value={method.value} />
                    {method.label && (
                      <Text span size="xs" c="dimmed">
                        {' '}
                        ({method.label}
                        {method.isPrimary ? ', primary' : ''})
                      </Text>
                    )}
                  </Text>
                </Group>
              ))}
              {contact.addresses.map((address) => (
                <Group key={address.id} gap="xs" wrap="nowrap" align="flex-start">
                  <IconMapPin size={16} aria-hidden />
                  <Text size="sm">{formatAddress(address)}</Text>
                </Group>
              ))}
            </Stack>
          )}

          {contact.notes && (
            <>
              <Divider label="Notes" labelPosition="left" />
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                {contact.notes}
              </Text>
            </>
          )}

          <Divider label="Linked records" labelPosition="left" />
          {contact.links.length === 0 ? (
            <Text size="sm" c="dimmed">
              Not linked to any record.
            </Text>
          ) : (
            <Stack gap={4}>
              {contact.links.map((link) => {
                const target = describeLink(link);
                return (
                  <Text key={`${link.entityType}:${link.entityId}:${link.relationship}`} size="sm">
                    {target.href ? (
                      <Anchor component={Link} to={target.href}>
                        {target.label}
                      </Anchor>
                    ) : (
                      target.label
                    )}
                    <Text span size="xs" c="dimmed">
                      {' '}
                      ({link.relationship})
                    </Text>
                  </Text>
                );
              })}
            </Stack>
          )}

          <Text size="xs" c="dimmed">
            Added {dayjs(contact.createdAt).format('D MMM YYYY, HH:mm')}
          </Text>
        </>
      )}

      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} title="That did not work" role="alert">
          {error}
        </Alert>
      )}

      {canEdit && (
        <Group justify="space-between">
          <Button variant="subtle" color="red" onClick={() => setConfirmDelete(true)} disabled={update.isPending || editing}>
            Delete contact
          </Button>
          {editing ? (
            <Group>
              <Button variant="default" onClick={() => { setDraft(toDraft(contact)); setEditing(false); setError(null); }} disabled={update.isPending}>
                Cancel
              </Button>
              <Button onClick={onSave} loading={update.isPending} disabled={nameMissing}>
                Save
              </Button>
            </Group>
          ) : (
            <Button variant="default" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </Group>
      )}

      <Modal opened={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this contact?" centered>
        <Stack>
          <Text size="sm">
            {contact.displayName} will be removed from your contacts. The business card it came from is not deleted.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button color="red" onClick={onDelete} loading={remove.isPending}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
