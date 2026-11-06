import type { TokenCacheStore } from './microsoft-identity.types';

/** The only part of the session this needs: where the serialized MSAL cache lives (server-side only). */
export interface TokenCacheHolder {
  msalCache?: string;
}

/** A token cache stored in the caller's server-side session. */
export function sessionTokenCache(holder: TokenCacheHolder): TokenCacheStore {
  return {
    load: () => holder.msalCache,
    save: (serialized) => {
      holder.msalCache = serialized;
    },
  };
}

/**
 * Writes go to a staging area first. Used when tokens for an account that is NOT yet trusted are obtained
 * (e.g. Connect OneDrive, before checking it is the same Microsoft account as the signed-in user):
 * `commit()` merges them into the session, and dropping the stage leaves the session untouched.
 */
export function stagedTokenCache(base: TokenCacheStore): { store: TokenCacheStore; commit: () => void } {
  let staged: string | undefined;
  return {
    store: {
      load: () => staged ?? base.load(),
      save: (serialized) => {
        staged = serialized;
      },
    },
    commit: () => {
      if (staged !== undefined) base.save(staged);
    },
  };
}
