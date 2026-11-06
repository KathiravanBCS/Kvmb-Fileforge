import { randomUUID } from 'node:crypto';

import { createFakePrisma, FakeTable, type FakePrisma, type FakeTables } from './fake-prisma';

const FILE_COLUMNS = [
  'id',
  'connection_id',
  'owner_user_id',
  'uploaded_by',
  'display_name',
  'stored_name',
  'file_extension',
  'mime_type',
  'size_bytes',
  'checksum_sha256',
  'content_version',
  'external_drive_id',
  'external_item_id',
  'external_etag',
  'external_ctag',
  'external_created_at',
  'external_last_modified_at',
  'upload_status',
  'uploaded_at',
  'last_error_code',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'is_deleted',
  'deleted_at',
  'deleted_by',
  'recovery_attempts',
  'next_recovery_at',
  'last_recovery_at',
  'last_recovery_outcome',
  'needs_review',
  'review_reason',
  'pending_size_bytes',
  'pending_checksum_sha256',
  'recovery_lease_token',
  'recovery_lease_until',
];

const SLOT_COLUMNS = [
  'id',
  'user_id',
  'operation',
  'request_id',
  'lease_token',
  'created_at',
  'lease_expires_at',
  'released_at',
  'outcome',
];

const CONNECTION_COLUMNS = [
  'id',
  'provider_type_id',
  'owner_user_id',
  'account_issuer',
  'account_subject',
  'account_tenant_id',
  'account_type',
  'home_account_id',
  'account_email',
  'account_display_name',
  'external_drive_id',
  'root_folder_item_id',
  'root_folder_path',
  'users_folder_item_id',
  'connection_status',
  'consented_scopes',
  'token_cache_ciphertext',
  'token_cache_nonce',
  'token_cache_auth_tag',
  'encryption_key_version',
  'cache_revision',
  'cache_updated_at',
  'last_auth_at',
  'last_verified_at',
  'last_error_code',
  'last_error_at',
  'quota_total_bytes',
  'quota_used_bytes',
  'quota_remaining_bytes',
  'quota_state',
  'quota_checked_at',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'is_deleted',
  'deleted_at',
  'deleted_by',
];

const EVENT_COLUMNS = [
  'id',
  'workspace_id',
  'actor_user_id',
  'actor_type',
  'action',
  'entity_type_id',
  'entity_id',
  'old_values',
  'new_values',
  'request_id',
  'ip_address',
  'occurred_at',
];

/** The users every central storage test knows about. Ids are the real BIGINT type. */
export const USER = { admin: 1n, alice: 2n, bob: 3n, inactive: 4n } as const;

const live = () => ({
  is_deleted: false,
  deleted_at: null,
  deleted_by: null,
  created_at: new Date(),
  updated_at: null,
});

/** Fresh, empty tables for the models central storage reads or writes. Nothing else is registered (so reading it throws). */
export function centralTables(): FakeTables {
  return {
    users: new FakeTable('users', { defaults: () => ({ ...live(), is_active: true, display_name: null }) }),
    system_admins: new FakeTable('system_admins', { defaults: () => ({ ...live(), is_active: true }) }),
    user_identities: new FakeTable('user_identities', { defaults: () => ({ ...live(), provider: 'microsoft' }) }),
    storage_provider_types: new FakeTable('storage_provider_types', {
      defaults: () => ({ ...live(), is_active: true }),
    }),
    entity_types: new FakeTable('entity_types', { defaults: () => ({ ...live() }) }),
    events: new FakeTable('events', { columns: EVENT_COLUMNS, defaults: () => ({ occurred_at: new Date() }) }),
    central_files: new FakeTable('central_files', {
      columns: FILE_COLUMNS,
      defaults: () => ({
        ...live(),
        content_version: 1,
        upload_status: 'pending',
        size_bytes: 0n,
        file_extension: null,
        checksum_sha256: null,
        external_item_id: null,
        external_etag: null,
        external_ctag: null,
        external_created_at: null,
        external_last_modified_at: null,
        uploaded_at: null,
        last_error_code: null,
        recovery_attempts: 0,
        next_recovery_at: null,
        last_recovery_at: null,
        last_recovery_outcome: null,
        needs_review: false,
        review_reason: null,
        pending_size_bytes: null,
        pending_checksum_sha256: null,
        recovery_lease_token: null,
        recovery_lease_until: null,
      }),
    }),
    central_upload_slots: new FakeTable('central_upload_slots', {
      columns: SLOT_COLUMNS,
      defaults: () => ({
        lease_token: randomUUID(),
        created_at: new Date(),
        request_id: null,
        released_at: null,
        outcome: null,
      }),
    }),
    central_connection: new FakeTable('central_connection', {
      columns: CONNECTION_COLUMNS,
      defaults: () => ({
        ...live(),
        connection_status: 'unverified',
        cache_revision: 1n,
        encryption_key_version: 1,
        consented_scopes: [],
        last_auth_at: null,
        last_verified_at: null,
        last_error_code: null,
        last_error_at: null,
        quota_total_bytes: null,
        quota_used_bytes: null,
        quota_remaining_bytes: null,
        quota_state: null,
        quota_checked_at: null,
      }),
    }),
  };
}

export interface CentralWorld {
  tables: FakeTables;
  prisma: FakePrisma;
}

/**
 * Users: 1 = system administrator (a live grant), 2 = Alice and 3 = Bob (ordinary users), 4 = a deactivated user.
 * Alice and Bob each ALSO own a "personal workspace owner" membership in real life: that must never matter here, so the
 * workspace tables are deliberately not registered (any read of them throws).
 */
export function centralWorld(): CentralWorld {
  const tables = centralTables();
  tables['users']?.seed({ id: USER.admin, email: 'admin@example.com', display_name: 'Admin' });
  tables['users']?.seed({ id: USER.alice, email: 'alice@example.com', display_name: 'Alice' });
  tables['users']?.seed({ id: USER.bob, email: 'bob@example.com', display_name: 'Bob' });
  tables['users']?.seed({ id: USER.inactive, email: 'gone@example.com', is_active: false });
  tables['system_admins']?.seed({ user_id: USER.admin });
  tables['entity_types']?.seed({ id: 10n, code: 'central_file' });
  tables['entity_types']?.seed({ id: 11n, code: 'central_storage_connection' });
  return { tables, prisma: createFakePrisma(tables) };
}
