/**
 * The shared storage boundary: where a Microsoft Graph item sits relative to a top-level folder of a drive.
 *
 * FileForge keeps TWO independent roots in a OneDrive: the personal File Manager's `FileForge` and the central storage's
 * `FileForge-Central`. Graph permissions apply to the whole account, so each feature must itself refuse any item that is
 * not inside ITS root. Both use this one function, so the rule cannot drift between them.
 */
export type Ancestry = 'inside' | 'outside' | 'unknown';

/**
 * Classifies the `parentReference.path` Graph returns for an item (e.g. `/drive/root:/FileForge/invoices`).
 * It compares the FIRST path segment with the root folder name as a whole segment (case-insensitive, like OneDrive),
 * never as a string prefix: `FileForge-Central/...` is not inside `FileForge`, and neither is `FileForgeX/...`.
 *
 * `unknown` means Graph did not say (no path, or not a path we can read): the caller must then verify the ancestry
 * another way (walking the parent ids), never assume the item is inside.
 */
export function ancestryUnder(graphPath: string | undefined, rootName: string): Ancestry {
  if (!graphPath) return 'unknown';
  const marker = graphPath.indexOf('root:');
  if (marker < 0) return 'unknown';

  let rest = graphPath.slice(marker + 'root:'.length);
  try {
    rest = decodeURIComponent(rest);
  } catch {
    return 'unknown';
  }
  const first = rest.split('/').find((segment) => segment.length > 0);
  // The item sits directly in the drive's root: it is not inside any top-level folder.
  if (first === undefined) return 'outside';
  return first.normalize('NFC').toLowerCase() === rootName.normalize('NFC').toLowerCase() ? 'inside' : 'outside';
}
