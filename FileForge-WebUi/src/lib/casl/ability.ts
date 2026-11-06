import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';

export type AppAction = 'manage' | 'create' | 'read' | 'update' | 'delete' | 'download' | 'upload';

/**
 * - `File`: the personal OneDrive File Manager (permissions come from the workspace role).
 * - `CentralStorageFile`: a user's own files in central storage (any signed-in user).
 * - `CentralStorageAdministration`: everyone's files and the central OneDrive connection (system administrators only).
 * `all` is CASL's "any subject"; nothing here grants it, because it would also cover the administration subject.
 */
export type AppSubject = 'File' | 'CentralStorageFile' | 'CentralStorageAdministration' | 'all';

export type AppAbility = MongoAbility<[AppAction, AppSubject]>;

export interface AbilityOptions {
  /** A real, signed-in session (not the development preview). */
  signedIn?: boolean;
  /** The API's own verdict from `GET /central-storage/capabilities`, never anything the browser decides. */
  isSystemAdmin?: boolean;
}

/**
 * What the UI shows. It mirrors what FileForge-Api enforces and exists only to hide controls that would be refused:
 * the backend is the real authorization, and nothing here protects data.
 *
 * - Workspace roles (`owner`/`admin`/`editor`/`viewer`) only ever govern the personal File Manager (`File`). In particular a
 *   workspace owner is NOT a system administrator: every user owns their personal workspace.
 * - Central storage: every signed-in user manages their own files; administration needs the server's `isSystemAdmin`.
 *
 * Unknown or missing roles (still loading, failed to load, a role added later) get no File Manager abilities.
 */
export function defineAbilityFor(role: string | undefined, options: AbilityOptions = {}): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  switch (role) {
    case 'owner':
    case 'admin':
      can('manage', 'File');
      break;
    case 'editor':
      can(['read', 'download', 'upload', 'create', 'update'], 'File');
      break;
    case 'viewer':
      can(['read', 'download'], 'File');
      break;
  }

  if (options.signedIn) {
    can(['read', 'create', 'upload', 'update', 'delete', 'download'], 'CentralStorageFile');
    if (options.isSystemAdmin) can('manage', 'CentralStorageAdministration');
  }

  return build();
}
