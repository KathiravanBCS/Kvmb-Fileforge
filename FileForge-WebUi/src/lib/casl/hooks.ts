import { createContext, useContext } from 'react';

import { defineAbilityFor, type AppAbility } from './ability';

// Defaults to "can do nothing", so a component rendered outside the provider fails closed.
export const AbilityContext = createContext<AppAbility>(defineAbilityFor(undefined));

/** The ability of the signed-in user in the active workspace. */
export function useAbility(): AppAbility {
  return useContext(AbilityContext);
}
