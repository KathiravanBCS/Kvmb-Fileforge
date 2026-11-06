/** Hands bytes to the browser as a file download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoked on the next tick so the browser has started the download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
