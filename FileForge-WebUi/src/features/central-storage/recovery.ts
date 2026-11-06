import dayjs from 'dayjs';

import type { RecoveryItem } from './types';

/** What went wrong with the file, from the status it was left in. */
export const PROBLEM_LABEL: Record<string, string> = {
  pending: 'Upload interrupted',
  uploading: 'Upload interrupted',
  replacing: 'Replacement interrupted',
  deleting: 'Delete interrupted',
  failed: 'Upload failed',
};

export const STATE_BADGE: Record<RecoveryItem['state'], { label: string; color: string }> = {
  needs_review: { label: 'Needs review', color: 'red' },
  retrying: { label: 'Retrying', color: 'yellow' },
  waiting: { label: 'Waiting', color: 'gray' },
};

export const problemLabel = (status: string) => PROBLEM_LABEL[status] ?? status;

export const formatWhen = (value: string | null) => (value ? dayjs(value).format('D MMM YYYY, HH:mm') : '—');

/** The result of "Retry now" in words (the toast). */
export function describeOutcome(outcome: string, item: RecoveryItem): { color: string; title: string; message: string } {
  switch (outcome) {
    case 'repaired':
      return { color: 'green', title: 'Recovered', message: `${item.fileName} is consistent again.` };
    case 'needs_review':
      return { color: 'yellow', title: 'Needs your review', message: item.explanation };
    case 'retry_scheduled':
      return { color: 'yellow', title: 'Couldn’t finish yet', message: 'It will be tried again automatically, or retry it later.' };
    case 'reauth_required':
      return { color: 'yellow', title: 'OneDrive needs to be reconnected', message: 'Reconnect it in Storage Settings, then retry.' };
    case 'lease_lost':
      return { color: 'yellow', title: 'The file changed meanwhile', message: 'Nothing was changed. Look at its current state and retry if needed.' };
    default:
      return { color: 'blue', title: 'Nothing to do', message: `${item.fileName} needs no repair.` };
  }
}

const EVENT_LABEL: Record<string, string> = {
  'central_storage.recovery.repaired': 'Repaired',
  'central_storage.recovery.needs_review': 'Handed to an administrator',
  'central_storage.recovery.retry_requested': 'Retry requested',
  'central_storage.recovery.dismissed': 'Marked as reviewed',
};

export const eventLabel = (action: string) => EVENT_LABEL[action] ?? action.replace('central_storage.recovery.', '');

export function actorLabel(actorType: string): string {
  if (actorType === 'system') return 'Automatic recovery';
  if (actorType === 'system_admin') return 'An administrator';
  return actorType;
}
