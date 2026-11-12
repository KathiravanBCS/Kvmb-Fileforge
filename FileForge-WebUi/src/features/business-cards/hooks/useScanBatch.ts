import { useRef, useState } from 'react';

import { ApiError } from '@/lib/api-types';
import { useScanBusinessCard } from '../api/useScanBusinessCard';
import type { BusinessCard } from '../types';
import { scanErrorMessage } from '../utils';

export interface BatchCard {
  id: string;
  front: File;
  back?: File;
  /** queued: waiting · scanning: being read now · failed: tried and refused (it stays here, to retry or remove). */
  status: 'queued' | 'scanning' | 'failed';
  error?: string;
}

/**
 * A queue of cards to scan, read ONE AT A TIME (the card reader and the upload limit are shared, so parallel requests would only
 * run into them). A card that is read leaves the queue; one that fails stays, with the reason; a rate limit pauses the whole queue
 * and keeps the remaining cards waiting. `onFinished` receives every card scanned by a run.
 */
export function useScanBatch(onFinished: (scanned: BusinessCard[]) => void) {
  const scan = useScanBusinessCard();
  // `cards` is what is drawn. `latest` mirrors it so the (asynchronous) loop below always sees the current queue, not the one
  // from the render it started in.
  const [cards, setCards] = useState<BatchCard[]>([]);
  const latest = useRef<BatchCard[]>([]);
  const next = useRef(1);
  const running = useRef(false);
  const [isRunning, setIsRunning] = useState(false);
  const [pausedBecause, setPausedBecause] = useState<string | null>(null);

  const change = (update: (current: BatchCard[]) => BatchCard[]) => {
    latest.current = update(latest.current);
    setCards(latest.current);
  };
  const patch = (id: string, fields: Partial<BatchCard>) =>
    change((current) => current.map((card) => (card.id === id ? { ...card, ...fields } : card)));

  const add = (photos: { front: File; back?: File }) =>
    change((current) => [...current, { id: `card-${next.current++}`, ...photos, status: 'queued' }]);

  const remove = (id: string) => change((current) => current.filter((card) => card.id !== id || card.status === 'scanning'));

  const addBack = (id: string, back: File) =>
    change((current) => current.map((card) => (card.id === id && card.status !== 'scanning' ? { ...card, back, status: 'queued', error: undefined } : card)));

  const run = async () => {
    if (running.current) return;
    running.current = true;
    setIsRunning(true);
    setPausedBecause(null);
    const scanned: BusinessCard[] = [];
    const tried = new Set<string>();

    try {
      for (;;) {
        const card = latest.current.find((c) => c.status !== 'scanning' && !tried.has(c.id));
        if (!card) break;
        tried.add(card.id);
        patch(card.id, { status: 'scanning', error: undefined });
        try {
          scanned.push(await scan.mutateAsync({ front: card.front, back: card.back }));
          change((current) => current.filter((c) => c.id !== card.id));
        } catch (error) {
          if (error instanceof ApiError && error.status === 429) {
            // Too many scans just now: stop here, keep this card and the rest waiting.
            patch(card.id, { status: 'queued' });
            setPausedBecause(scanErrorMessage(error));
            break;
          }
          patch(card.id, { status: 'failed', error: scanErrorMessage(error) });
        }
      }
    } finally {
      running.current = false;
      setIsRunning(false);
      if (scanned.length > 0) onFinished(scanned);
    }
  };

  return { cards, isRunning, pausedBecause, add, addBack, remove, run };
}
