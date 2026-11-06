import { useMemo, type ReactNode } from 'react';

import { useGetCapabilities } from '@/features/central-storage/api/useGetCapabilities';
import { useAuth } from '@/features/auth/useAuth';
import { useWorkspaces } from '@/features/workspaces/hooks/useWorkspaces';
import { defineAbilityFor } from './ability';
import { AbilityContext } from './hooks';

/**
 * Builds the ability from the user's role in the active workspace (already loaded by `GET /workspaces`) and, for central
 * storage, from the API's own answer about administrator status.
 */
export function AbilityProvider({ children }: { children: ReactNode }) {
  const role = useWorkspaces().active?.role;
  const signedIn = useAuth().status === 'authenticated';
  // Only a failed or pending answer ever means "not an administrator": the default is the safe one.
  const isSystemAdmin = useGetCapabilities().data?.isSystemAdmin === true;
  const ability = useMemo(() => defineAbilityFor(role, { signedIn, isSystemAdmin }), [role, signedIn, isSystemAdmin]);

  return <AbilityContext.Provider value={ability}>{children}</AbilityContext.Provider>;
}
