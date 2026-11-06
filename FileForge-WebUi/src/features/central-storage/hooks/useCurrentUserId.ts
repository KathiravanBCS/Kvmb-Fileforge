import { useAuth } from '@/features/auth/useAuth';

/** The signed-in user's id, or undefined (no session / development preview). Every central-storage cache key carries it. */
export function useCurrentUserId(): string | undefined {
  return useAuth().user?.id;
}
