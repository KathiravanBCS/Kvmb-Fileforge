import { useAuth } from '@/features/auth/useAuth';
import { useWorkspaces } from './useWorkspaces';

/**
 * Who is asking and for which workspace. Both are part of every business card and contact cache key, so one user's (or one
 * workspace's) data is never served to another. `ready` is false until both are known.
 */
export function useWorkspaceScope() {
  const userId = useAuth().user?.id;
  const workspaceId = useWorkspaces().active?.id;
  return { userId, workspaceId, ready: userId !== undefined && workspaceId !== undefined };
}
