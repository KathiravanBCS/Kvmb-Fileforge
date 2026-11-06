import type { ReactNode } from 'react';
import { Badge, Button, Divider, Drawer, Group, Stack, Text } from '@mantine/core';
import { IconDownload, IconEye, IconPencil, IconReplace, IconTrash } from '@tabler/icons-react';
import dayjs from 'dayjs';

import type { CentralFile } from '../types';
import { fileKind, formatBytes, ownerLabel } from '../utils';

interface FileDetailsDrawerProps {
  file: CentralFile | null;
  /** Administrators also see the owner and who uploaded the file. */
  showOwner: boolean;
  /** Storage unavailable: everything that needs OneDrive is disabled. */
  contentDisabled: boolean;
  onClose: () => void;
  onPreview: (file: CentralFile) => void;
  onDownload: (file: CentralFile) => void;
  onRename: (file: CentralFile) => void;
  onReplace: (file: CentralFile) => void;
  onDelete: (file: CentralFile) => void;
}

const formatDate = (value: string | null) => (value ? dayjs(value).format('D MMM YYYY, HH:mm') : '—');

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" align="flex-start" gap="md">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text size="sm" ta="right" style={{ wordBreak: 'break-word' }}>
        {children}
      </Text>
    </Group>
  );
}

/** Everything the API says about a file, with the actions that apply to it. */
export function FileDetailsDrawer({ file, showOwner, contentDisabled, onClose, onPreview, onDownload, onRename, onReplace, onDelete }: FileDetailsDrawerProps) {
  const kind = file ? fileKind(file.extension) : null;

  return (
    <Drawer opened={file !== null} onClose={onClose} position="right" title="File details" size="md">
      {file && kind && (
        <Stack gap="md">
          <Group gap="xs" wrap="nowrap">
            <kind.icon size={28} aria-hidden />
            <Text fw={600} style={{ wordBreak: 'break-word' }}>
              {file.name}
            </Text>
          </Group>

          <Stack gap="xs">
            <Row label="Type">
              <Badge variant="light" color={kind.color}>
                {kind.label}
              </Badge>
            </Row>
            <Row label="Size">{formatBytes(file.size)}</Row>
            <Row label="Content type">{file.mimeType}</Row>
            <Row label="Uploaded">{formatDate(file.uploadedAt ?? file.createdAt)}</Row>
            <Row label="Last changed">{formatDate(file.updatedAt)}</Row>
            <Row label="Version">{file.contentVersion}</Row>
            <Row label="Status">{file.status === 'ready' ? 'Ready' : file.status === 'replacing' ? 'Being updated' : file.status}</Row>
            {showOwner && (
              <>
                <Divider />
                <Row label="Owner">{ownerLabel(file.owner)}</Row>
                {file.owner && <Row label="Owner e-mail">{file.owner.email}</Row>}
                <Row label="Uploaded by">{file.uploadedById === file.ownerId ? 'The owner' : `User ${file.uploadedById} (an administrator)`}</Row>
              </>
            )}
          </Stack>

          <Divider />
          <Group gap="xs">
            {file.previewable && (
              <Button variant="light" size="xs" leftSection={<IconEye size={14} />} disabled={contentDisabled} onClick={() => onPreview(file)}>
                Preview
              </Button>
            )}
            <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} disabled={contentDisabled} onClick={() => onDownload(file)}>
              Download
            </Button>
            <Button variant="default" size="xs" leftSection={<IconPencil size={14} />} onClick={() => onRename(file)}>
              Rename
            </Button>
            <Button variant="default" size="xs" leftSection={<IconReplace size={14} />} disabled={contentDisabled} onClick={() => onReplace(file)}>
              Replace content
            </Button>
            <Button variant="light" color="red" size="xs" leftSection={<IconTrash size={14} />} disabled={contentDisabled} onClick={() => onDelete(file)}>
              Delete
            </Button>
          </Group>
        </Stack>
      )}
    </Drawer>
  );
}
