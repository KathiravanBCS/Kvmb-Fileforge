/**
 * Whether a workspace role may change content (scan business cards, edit or delete contacts). Viewers only read.
 * This hides controls that would be refused: the API checks the same roles and is the real authorization.
 */
export function canEditContent(role: string | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor';
}
