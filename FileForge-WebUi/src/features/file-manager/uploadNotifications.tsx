import { notifications } from '@mantine/notifications';
import { IconCheck, IconX } from '@tabler/icons-react';

// One toast per file, keyed by `id`, that moves from "uploading" to "uploaded" or "failed".

export function showUploading(id: string, name: string) {
  notifications.show({
    id,
    loading: true,
    title: `Uploading ${name}`,
    message: '0%',
    autoClose: false,
    withCloseButton: false,
  });
}

export function showUploadProgress(id: string, name: string, percent: number) {
  notifications.update({ id, loading: true, title: `Uploading ${name}`, message: `${percent}%`, autoClose: false });
}

export function showUploaded(id: string, name: string) {
  notifications.update({
    id,
    loading: false,
    color: 'green',
    icon: <IconCheck size={18} />,
    title: 'Uploaded',
    message: name,
    autoClose: 4000,
    withCloseButton: true,
  });
}

/** Stays until dismissed, so the reason is not missed. */
export function showUploadFailed(id: string, name: string, reason: string) {
  notifications.update({
    id,
    loading: false,
    color: 'red',
    icon: <IconX size={18} />,
    title: `Couldn't upload ${name}`,
    message: reason,
    autoClose: false,
    withCloseButton: true,
  });
}
