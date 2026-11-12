import { useState } from 'react';
import { Alert, Badge, Loader, Pagination, Paper, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconAddressBook, IconAlertTriangle, IconSearch } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';

import { EmptyState } from '@/components/feedback/EmptyState';
import { PageContainer } from '@/components/layout/PageContainer';
import { useWorkspaces } from '@/features/workspaces/hooks/useWorkspaces';
import { canEditContent } from '@/features/workspaces/roles';
import { useGetContacts } from '../api/useGetContacts';
import { ContactDrawer } from '../components/ContactDrawer';
import { REVIEW_STATUSES, type ContactSummary, type ReviewStatus } from '../types';
import { contactErrorMessage, REVIEW_LABELS } from '../utils';

const PAGE_SIZE = 25;

export function ContactsPage() {
  const workspaces = useWorkspaces();
  const canEdit = canEditContent(workspaces.active?.role);
  const [params, setParams] = useSearchParams();
  const openId = params.get('open');

  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const [status, setStatus] = useState<ReviewStatus | null>(null);
  const [page, setPage] = useState(1);
  const contacts = useGetContacts({ page, pageSize: PAGE_SIZE, q: debounced || undefined, reviewStatus: status ?? undefined });

  const open = (id: string | null) => setParams(id ? { open: id } : {}, { replace: false });
  const items = contacts.data?.items ?? [];
  const total = contacts.data?.total ?? 0;
  const filtering = debounced !== '' || status !== null;

  return (
    <PageContainer
      title="Contacts"
      description="Everyone you have saved, from business cards and every other module."
      toolbar={
        <>
          <TextInput
            aria-label="Search contacts"
            placeholder="Search name, company or e-mail"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              setPage(1);
            }}
            w={{ base: '100%', sm: 320 }}
          />
          <Select
            aria-label="Filter by review status"
            placeholder="Any review status"
            clearable
            value={status}
            data={REVIEW_STATUSES.map((s) => ({ value: s, label: REVIEW_LABELS[s]?.label ?? s }))}
            onChange={(value) => {
              setStatus(value as ReviewStatus | null);
              setPage(1);
            }}
            w={{ base: '100%', sm: 200 }}
          />
        </>
      }
    >
      <Stack gap="lg">
        <Paper withBorder>
          {contacts.isPending ? (
            <Stack align="center" p="xl">
              <Loader />
            </Stack>
          ) : contacts.isError ? (
            <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Your contacts could not be loaded" m="md">
              {contactErrorMessage(contacts.error)}
            </Alert>
          ) : items.length === 0 ? (
            <EmptyState
              icon={IconAddressBook}
              title={filtering ? 'No contacts match' : 'No contacts yet'}
              description={
                filtering
                  ? 'Try a different search or clear the filter.'
                  : 'Scan a business card and save it, and the contact appears here.'
              }
            />
          ) : (
            <Table.ScrollContainer minWidth={720}>
              <Table highlightOnHover verticalSpacing="sm" aria-label="Contacts">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Company</Table.Th>
                    <Table.Th>E-mail</Table.Th>
                    <Table.Th>Phone</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Added</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {items.map((contact) => (
                    <ContactRow key={contact.id} contact={contact} onOpen={() => open(contact.id)} />
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Paper>

        {total > PAGE_SIZE && (
          <Pagination total={Math.ceil(total / PAGE_SIZE)} value={page} onChange={setPage} aria-label="Contact pages" />
        )}
      </Stack>

      <ContactDrawer contactId={openId} onClose={() => open(null)} canEdit={canEdit} />
    </PageContainer>
  );
}

function ContactRow({ contact, onOpen }: { contact: ContactSummary; onOpen: () => void }) {
  const review = REVIEW_LABELS[contact.reviewStatus] ?? { label: contact.reviewStatus, color: 'gray' };
  return (
    <Table.Tr
      tabIndex={0}
      style={{ cursor: 'pointer' }}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen();
      }}
      aria-label={`Open ${contact.displayName}`}
    >
      <Table.Td>
        <Text size="sm" fw={500}>
          {contact.displayName}
        </Text>
        {contact.jobTitle && (
          <Text size="xs" c="dimmed">
            {contact.jobTitle}
          </Text>
        )}
      </Table.Td>
      <Table.Td>{contact.organization ?? '—'}</Table.Td>
      <Table.Td>{contact.email ?? '—'}</Table.Td>
      <Table.Td>{contact.phone ?? '—'}</Table.Td>
      <Table.Td>
        <Badge color={review.color} variant="light">
          {review.label}
        </Badge>
      </Table.Td>
      <Table.Td>{dayjs(contact.createdAt).format('D MMM YYYY')}</Table.Td>
    </Table.Tr>
  );
}
