import { useGetWorkspaces } from '../api/useGetWorkspaces';
import type { Workspace } from '../types';

/** The workspaces of the signed-in user. There is no workspace switcher yet: the personal workspace is the active one. */
export function useWorkspaces() {
  const query = useGetWorkspaces();
  const workspaces = query.data;
  const active: Workspace | undefined = workspaces?.find((w) => w.type === 'personal') ?? workspaces?.[0];
  return { ...query, active };
}
