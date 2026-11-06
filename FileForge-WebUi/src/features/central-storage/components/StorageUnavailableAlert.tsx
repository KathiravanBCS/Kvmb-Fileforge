import { Alert, Button } from '@mantine/core';
import { IconPlugConnectedX } from '@tabler/icons-react';
import { Link } from 'react-router-dom';

interface StorageUnavailableAlertProps {
  /** Administrators get the way to fix it; everyone else is told to contact one. */
  isAdmin: boolean;
}

/**
 * Shown while central storage is not connected or needs reconnecting. It says plainly what is blocked, and offers no
 * success state: uploads, downloads and previews stay disabled until the API reports the storage as available.
 */
export function StorageUnavailableAlert({ isAdmin }: StorageUnavailableAlertProps) {
  return (
    <Alert
      color="yellow"
      variant="light"
      icon={<IconPlugConnectedX size={18} />}
      title="File storage isn’t available right now"
      role="status"
    >
      {isAdmin ? (
        <>
          The central OneDrive is not connected (or its access expired), so nobody can upload, open or delete files. You can still
          see the file list and rename files.{' '}
          <Button component={Link} to="/admin/storage/settings" size="compact-sm" variant="light" mt="xs" display="block" w="fit-content">
            Open storage settings
          </Button>
        </>
      ) : (
        <>
          Uploading and opening files is unavailable until an administrator connects the storage. Your files are safe; try again
          later or contact your administrator.
        </>
      )}
    </Alert>
  );
}
