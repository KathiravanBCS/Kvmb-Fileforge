import { useState } from 'react';
import { Alert, Badge, Button, Loader, Pagination, Paper, SegmentedControl, Stack, Table, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCamera, IconId } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';

import { EmptyState } from '@/components/feedback/EmptyState';
import { PageContainer } from '@/components/layout/PageContainer';
import { useWorkspaces } from '@/features/workspaces/hooks/useWorkspaces';
import { canEditContent } from '@/features/workspaces/roles';
import { useGetBusinessCards } from '../api/useGetBusinessCards';
import { CardDropzone } from '../components/CardDropzone';
import { CardReviewDrawer } from '../components/CardReviewDrawer';
import { CardSession } from '../components/CardSession';
import { ScanQueue } from '../components/ScanQueue';
import { useScanBatch, type BatchCard } from '../hooks/useScanBatch';
import { MAX_CARD_IMAGE_BYTES, SCAN_STATUSES, type BusinessCard, type ScanStatus } from '../types';
import { cardTitle, checkCardImage, scanErrorMessage, STATUS_BADGE } from '../utils';

const PAGE_SIZE = 25;
type Filter = ScanStatus | 'all';

export function BusinessCardsPage() {
  const workspaces = useWorkspaces();
  const canEdit = canEditContent(workspaces.active?.role);
  const [params, setParams] = useSearchParams();
  const openId = params.get('open');

  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const cards = useGetBusinessCards({ page, pageSize: PAGE_SIZE, status: filter === 'all' ? undefined : filter });
  const [problem, setProblem] = useState<string | null>(null);

  // The camera window: a new card, or only the back of a card that is already in the queue.
  const [camera, setCamera] = useState<{ open: boolean; backOf: BatchCard | null }>({ open: false, backOf: null });

  const open = (id: string | null) => setParams(id ? { open: id } : {}, { replace: false });

  const batch = useScanBatch((scanned) => {
    // One card: straight to its review. Several: show the ones waiting for review.
    if (scanned.length === 1) {
      open(scanned[0]!.id);
      return;
    }
    setFilter('pending');
    setPage(1);
    notifications.show({
      color: 'green',
      title: `${scanned.length} cards scanned`,
      message: 'Check each one below, then save it as a contact.',
    });
  });

  const onFiles = (files: File[]) => {
    const refused: string[] = [];
    for (const file of files) {
      const reason = checkCardImage(file, MAX_CARD_IMAGE_BYTES);
      if (reason) refused.push(`${file.name}: ${reason}`);
      else batch.add({ front: file });
    }
    setProblem(refused.length > 0 ? refused.join(' ') : null);
  };

  const items = cards.data?.items ?? [];
  const total = cards.data?.total ?? 0;
  const noPermission = canEdit || workspaces.isPending ? undefined : 'Your role in this workspace can view cards but not scan them.';

  return (
    <PageContainer
      title="Business Card Scanner"
      description="Photograph cards (front and back), check what was read, and save them as contacts."
      actions={
        <Button
          leftSection={<IconCamera size={18} />}
          onClick={() => setCamera({ open: true, backOf: null })}
          disabled={noPermission !== undefined}
        >
          Scan with camera
        </Button>
      }
    >
      <Stack gap="lg">
        <CardDropzone onFiles={onFiles} disabledReason={noPermission} />

        {problem && (
          <Alert
            color="red"
            icon={<IconAlertTriangle size={18} />}
            title="Some photos were not added"
            withCloseButton
            onClose={() => setProblem(null)}
            role="alert"
          >
            {problem}
          </Alert>
        )}

        <ScanQueue
          cards={batch.cards}
          running={batch.isRunning}
          pausedBecause={batch.pausedBecause}
          onScan={() => void batch.run()}
          onRemove={batch.remove}
          onAddBack={(card) => setCamera({ open: true, backOf: card })}
        />

        <SegmentedControl
          aria-label="Filter scanned cards"
          value={filter}
          onChange={(value) => {
            setFilter(value as Filter);
            setPage(1);
          }}
          data={[{ value: 'all', label: 'All' }, ...SCAN_STATUSES.map((s) => ({ value: s, label: STATUS_BADGE[s].label }))]}
          w="fit-content"
        />

        <Paper withBorder>
          {cards.isPending ? (
            <Stack align="center" p="xl">
              <Loader />
            </Stack>
          ) : cards.isError ? (
            <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Your scanned cards could not be loaded" m="md">
              {scanErrorMessage(cards.error)}
            </Alert>
          ) : items.length === 0 ? (
            <EmptyState
              icon={IconId}
              title={filter === 'all' ? 'No cards scanned yet' : 'No cards here'}
              description={
                filter === 'all'
                  ? 'Use the camera, or add photos above. You will check each card before it becomes a contact.'
                  : 'Nothing matches this filter.'
              }
            />
          ) : (
            <Table.ScrollContainer minWidth={640}>
              <Table highlightOnHover verticalSpacing="sm" aria-label="Scanned business cards">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Card</Table.Th>
                    <Table.Th>Company</Table.Th>
                    <Table.Th>E-mail</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Scanned</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {items.map((card) => (
                    <CardRow key={card.id} card={card} onOpen={() => open(card.id)} />
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Paper>

        {total > PAGE_SIZE && (
          <Pagination total={Math.ceil(total / PAGE_SIZE)} value={page} onChange={setPage} aria-label="Card pages" />
        )}
      </Stack>

      <CardSession
        opened={camera.open}
        onClose={() => setCamera({ open: false, backOf: null })}
        queuedCount={batch.cards.length}
        onAddCard={batch.add}
        backOf={
          camera.backOf
            ? {
                label: `card ${batch.cards.findIndex((c) => c.id === camera.backOf?.id) + 1}`,
                onBack: (file) => batch.addBack((camera.backOf as BatchCard).id, file),
              }
            : null
        }
      />
      <CardReviewDrawer cardId={openId} onClose={() => open(null)} canEdit={canEdit} />
    </PageContainer>
  );
}

function CardRow({ card, onOpen }: { card: BusinessCard; onOpen: () => void }) {
  const badge = STATUS_BADGE[card.status];
  return (
    <Table.Tr
      tabIndex={0}
      style={{ cursor: 'pointer' }}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen();
      }}
      aria-label={`Open ${cardTitle(card.data)}`}
    >
      <Table.Td>
        <Text size="sm" fw={500}>
          {cardTitle(card.data)}
        </Text>
        {card.data.jobTitle && (
          <Text size="xs" c="dimmed">
            {card.data.jobTitle}
          </Text>
        )}
      </Table.Td>
      <Table.Td>{card.data.companyName ?? '—'}</Table.Td>
      <Table.Td>{card.data.email ?? '—'}</Table.Td>
      <Table.Td>
        <Badge color={badge.color} variant="light">
          {badge.label}
        </Badge>
        {card.backImageFileId && (
          <Badge color="gray" variant="outline" ml={6}>
            2 sides
          </Badge>
        )}
      </Table.Td>
      <Table.Td>{dayjs(card.createdAt).format('D MMM YYYY, HH:mm')}</Table.Td>
    </Table.Tr>
  );
}
