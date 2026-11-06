import { useEffect, useState } from 'react';
import { Alert, Button, Center, Group, Loader, Modal, ScrollArea, Stack, Text } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';

import { usePreviewCentralFile } from '../api/usePreviewCentralFile';
import { useObjectUrl } from '../hooks/useObjectUrl';
import type { CentralFile, CentralScope } from '../types';
import { describeError, formatBytes } from '../utils';

interface FilePreviewModalProps {
  scope: CentralScope;
  file: CentralFile | null;
  onClose: () => void;
  onDownload: (file: CentralFile) => void;
}

/** The only content types ever shown inline. The server enforces the same list; this re-checks what actually arrived. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_TEXT_CHARS = 200_000;

/**
 * A safe inline preview: images, PDF and plain text only. Text is rendered as text (never as HTML). Anything else, including
 * a file whose bytes do not match what the server promised, is not rendered and offers the download instead.
 */
export function FilePreviewModal({ scope, file, onClose, onDownload }: FilePreviewModalProps) {
  return (
    <Modal
      opened={file !== null}
      onClose={onClose}
      title={file?.name ?? 'Preview'}
      size="xl"
      centered
      aria-label={file ? `Preview of ${file.name}` : undefined}
    >
      {/* Keyed by id so each file starts clean (new request, new object URL). */}
      {file && <PreviewBody key={file.id} scope={scope} file={file} onDownload={onDownload} />}
    </Modal>
  );
}

function PreviewBody({ scope, file, onDownload }: { scope: CentralScope; file: CentralFile; onDownload: (file: CentralFile) => void }) {
  const query = usePreviewCentralFile(scope, file.previewable ? file.id : null);
  const blob = query.data;
  const type = blob?.type.split(';')[0]?.trim().toLowerCase() ?? '';
  const isImage = IMAGE_TYPES.has(type);
  const isPdf = type === 'application/pdf';
  const isText = type === 'text/plain';

  // Only a blob whose OWN type is image or PDF is ever given an address; anything else is never put in the page.
  const objectUrl = useObjectUrl(isImage || isPdf ? blob : undefined);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!blob || !isText) return;
    let cancelled = false;
    void blob.text().then((value) => {
      if (!cancelled) setText(value.length > MAX_TEXT_CHARS ? `${value.slice(0, MAX_TEXT_CHARS)}\n\n… (preview shortened, download the file to read the rest)` : value);
    });
    return () => {
      cancelled = true;
    };
  }, [blob, isText]);

  const download = (
    <Button variant="light" leftSection={<IconDownload size={16} />} onClick={() => onDownload(file)}>
      Download
    </Button>
  );

  if (!file.previewable) {
    return (
      <Stack align="center" py="lg">
        <Text size="sm" c="dimmed" ta="center">
          This file type can’t be previewed. {formatBytes(file.size)} · download it to open it.
        </Text>
        {download}
      </Stack>
    );
  }
  if (query.isPending) {
    return (
      <Center mih={200}>
        <Loader aria-label="Loading preview" />
      </Center>
    );
  }
  if (query.isError) {
    return (
      <Stack>
        <Alert color="red" variant="light" role="alert" title="The preview couldn’t be loaded">
          {describeError(query.error)}
        </Alert>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => void query.refetch()}>
            Try again
          </Button>
          {download}
        </Group>
      </Stack>
    );
  }
  if (!isImage && !isPdf && !isText) {
    return (
      <Stack align="center" py="lg">
        <Text size="sm" c="dimmed" ta="center">
          This file can’t be shown safely in the browser. Download it instead.
        </Text>
        {download}
      </Stack>
    );
  }

  return (
    <Stack>
      {isImage && objectUrl && (
        <Center>
          <img src={objectUrl} alt={file.name} style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }} />
        </Center>
      )}
      {isPdf && objectUrl && <iframe src={objectUrl} title={`PDF preview of ${file.name}`} style={{ width: '100%', height: '70vh', border: 0 }} />}
      {isText && (
        <ScrollArea h="60vh" type="auto">
          <Text component="pre" size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontFamily: 'var(--mantine-font-family-monospace)' }}>
            {text ?? ''}
          </Text>
        </ScrollArea>
      )}
      <Group justify="flex-end">{download}</Group>
    </Stack>
  );
}
