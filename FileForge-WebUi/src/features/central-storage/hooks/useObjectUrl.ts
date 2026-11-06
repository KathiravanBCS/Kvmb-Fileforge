import { useEffect, useState } from 'react';

/**
 * A temporary `blob:` address for showing a Blob in an <img> or <iframe>, revoked as soon as it is no longer needed.
 *
 * Each run of the effect makes its OWN url and revokes exactly that one on cleanup, and the state is only set from a
 * microtask: that stays correct when React runs effects twice in development (a url revoked while still shown would be a
 * broken image), and never exposes a revoked url to render.
 */
export function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) return;
    const created = URL.createObjectURL(blob);
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setUrl(created);
    });
    return () => {
      active = false;
      URL.revokeObjectURL(created);
      setUrl((current) => (current === created ? null : current));
    };
  }, [blob]);

  return url;
}
