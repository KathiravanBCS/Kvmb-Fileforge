import { describe, expect, it } from 'vitest';

import { defineAbilityFor } from './ability';

describe('central storage abilities', () => {
  it('every signed-in user manages their own central files, and nothing else about central storage', () => {
    const ability = defineAbilityFor(undefined, { signedIn: true });
    for (const action of ['read', 'create', 'upload', 'update', 'delete', 'download'] as const) {
      expect(ability.can(action, 'CentralStorageFile')).toBe(true);
    }
    expect(ability.can('manage', 'CentralStorageAdministration')).toBe(false);
    expect(ability.can('read', 'CentralStorageAdministration')).toBe(false);
  });

  it('a signed-out visitor (or the development preview) can do nothing', () => {
    const ability = defineAbilityFor('owner');
    expect(ability.can('read', 'CentralStorageFile')).toBe(false);
    expect(ability.can('manage', 'CentralStorageAdministration')).toBe(false);
  });

  it('only the API-confirmed system administrator can administer central storage', () => {
    expect(defineAbilityFor(undefined, { signedIn: true, isSystemAdmin: true }).can('manage', 'CentralStorageAdministration')).toBe(true);
    expect(defineAbilityFor(undefined, { signedIn: true, isSystemAdmin: false }).can('manage', 'CentralStorageAdministration')).toBe(false);
    // ...and never without a session, whatever else is claimed.
    expect(defineAbilityFor(undefined, { signedIn: false, isSystemAdmin: true }).can('manage', 'CentralStorageAdministration')).toBe(false);
  });

  it.each(['owner', 'admin', 'editor', 'viewer', 'something-new', undefined])(
    'the workspace role %s never makes a user a system administrator',
    (role) => {
      // Every user owns their personal workspace: if "owner" meant administrator, everybody would be one.
      const ability = defineAbilityFor(role, { signedIn: true, isSystemAdmin: false });
      expect(ability.can('manage', 'CentralStorageAdministration')).toBe(false);
      expect(ability.can('delete', 'CentralStorageAdministration')).toBe(false);
    },
  );
});

describe('the personal File Manager keeps its role-based abilities (unchanged behaviour)', () => {
  it('owner and admin manage files', () => {
    for (const role of ['owner', 'admin']) {
      const ability = defineAbilityFor(role, { signedIn: true });
      expect(ability.can('manage', 'File')).toBe(true);
      expect(ability.can('upload', 'File')).toBe(true);
      expect(ability.can('update', 'File')).toBe(true);
      expect(ability.can('delete', 'File')).toBe(true);
    }
  });

  it('editor can read, download, upload and update, but not delete or manage', () => {
    const ability = defineAbilityFor('editor', { signedIn: true });
    expect(ability.can('upload', 'File')).toBe(true);
    expect(ability.can('update', 'File')).toBe(true);
    expect(ability.can('delete', 'File')).toBe(false);
    expect(ability.can('manage', 'File')).toBe(false);
  });

  it('viewer can only read and download', () => {
    const ability = defineAbilityFor('viewer', { signedIn: true });
    expect(ability.can('read', 'File')).toBe(true);
    expect(ability.can('download', 'File')).toBe(true);
    expect(ability.can('upload', 'File')).toBe(false);
  });

  it('an unknown role gets nothing', () => {
    const ability = defineAbilityFor('mystery');
    expect(ability.can('read', 'File')).toBe(false);
  });
});
