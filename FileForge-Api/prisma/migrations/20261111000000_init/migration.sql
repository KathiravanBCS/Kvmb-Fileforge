-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "master";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "permissions" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" BIGSERIAL NOT NULL,
    "role_id" BIGINT NOT NULL,
    "permission_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_identities" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "account_type" VARCHAR(30) NOT NULL DEFAULT 'unknown',
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "tenant_id" VARCHAR(100),
    "home_account_id" VARCHAR(255),
    "provider_user_id" VARCHAR(255),
    "login_hint" VARCHAR(320),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "auth_provider" VARCHAR(40) NOT NULL DEFAULT 'local',
    "external_subject" VARCHAR(255),
    "email" VARCHAR(320) NOT NULL,
    "display_name" VARCHAR(200),
    "avatar_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_invitations" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" BIGINT NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "role_id" BIGINT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "invited_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "workspace_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "role_id" BIGINT NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invited_by" BIGINT,
    "membership_status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_settings" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" BIGINT NOT NULL,
    "setting_key" VARCHAR(100) NOT NULL,
    "setting_value" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "workspace_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "workspace_type" VARCHAR(20) NOT NULL,
    "owner_user_id" BIGINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master"."contact_source_types" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "contact_source_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master"."email_event_types" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "email_event_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master"."entity_types" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "entity_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master"."job_statuses" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "is_terminal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "job_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master"."storage_provider_types" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "storage_provider_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master"."tool_types" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "tool_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connections" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" BIGINT NOT NULL,
    "provider_type_id" BIGINT NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secret_reference" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,
    "owner_user_id" BIGINT,
    "auth_mode" VARCHAR(30) NOT NULL DEFAULT 'provider_specific',
    "connection_status" VARCHAR(30) NOT NULL DEFAULT 'unverified',
    "external_drive_id" TEXT,
    "root_folder_item_id" TEXT,
    "root_folder_path" TEXT,
    "consented_scopes" TEXT[],
    "last_auth_at" TIMESTAMPTZ(6),

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_links" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" BIGINT NOT NULL,
    "file_id" BIGINT NOT NULL,
    "entity_type_id" BIGINT NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "purpose" VARCHAR(60),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "file_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_versions" (
    "id" BIGSERIAL NOT NULL,
    "file_id" BIGINT NOT NULL,
    "external_version_id" TEXT,
    "size_bytes" BIGINT,
    "checksum_sha256" VARCHAR(64),
    "version_number" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "file_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" BIGINT NOT NULL,
    "connection_id" BIGINT NOT NULL,
    "external_object_id" TEXT NOT NULL,
    "external_parent_id" TEXT,
    "filename" TEXT NOT NULL,
    "mime_type" VARCHAR(255),
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "checksum_sha256" VARCHAR(64),
    "storage_path" TEXT,
    "uploaded_by" BIGINT,
    "upload_status" VARCHAR(30) NOT NULL DEFAULT 'ready',
    "external_created_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,
    "external_drive_id" TEXT,
    "external_web_url" TEXT,
    "external_etag" TEXT,
    "external_ctag" TEXT,
    "external_last_modified_at" TIMESTAMPTZ(6),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folder_mappings" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" BIGINT NOT NULL,
    "connection_id" BIGINT NOT NULL,
    "module_code" VARCHAR(80) NOT NULL,
    "folder_name" VARCHAR(255) NOT NULL,
    "external_folder_item_id" TEXT,
    "relative_path" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "folder_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" BIGINT NOT NULL,
    "file_id" BIGINT,
    "connection_id" BIGINT,
    "operation" VARCHAR(30) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "error_message" TEXT,
    "performed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_admins" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "granted_by" BIGINT,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "system_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "central_connection" (
    "id" BIGSERIAL NOT NULL,
    "provider_type_id" BIGINT NOT NULL,
    "owner_user_id" BIGINT NOT NULL,
    "account_issuer" TEXT NOT NULL,
    "account_subject" TEXT NOT NULL,
    "account_tenant_id" VARCHAR(100),
    "account_type" VARCHAR(30) NOT NULL DEFAULT 'unknown',
    "home_account_id" VARCHAR(255) NOT NULL,
    "account_email" VARCHAR(320),
    "account_display_name" VARCHAR(200),
    "external_drive_id" TEXT NOT NULL,
    "root_folder_item_id" TEXT NOT NULL,
    "root_folder_path" TEXT NOT NULL DEFAULT 'FileForge-Central',
    "users_folder_item_id" TEXT NOT NULL,
    "connection_status" VARCHAR(30) NOT NULL DEFAULT 'unverified',
    "consented_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "token_cache_ciphertext" BYTEA NOT NULL,
    "token_cache_nonce" BYTEA NOT NULL,
    "token_cache_auth_tag" BYTEA NOT NULL,
    "encryption_key_version" SMALLINT NOT NULL DEFAULT 1,
    "cache_revision" BIGINT NOT NULL DEFAULT 1,
    "cache_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_auth_at" TIMESTAMPTZ(6),
    "last_verified_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(60),
    "last_error_at" TIMESTAMPTZ(6),
    "quota_total_bytes" BIGINT,
    "quota_used_bytes" BIGINT,
    "quota_remaining_bytes" BIGINT,
    "quota_state" VARCHAR(20),
    "quota_checked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,

    CONSTRAINT "central_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "central_files" (
    "id" BIGSERIAL NOT NULL,
    "connection_id" BIGINT NOT NULL,
    "owner_user_id" BIGINT NOT NULL,
    "uploaded_by" BIGINT NOT NULL,
    "display_name" TEXT NOT NULL,
    "stored_name" VARCHAR(100) NOT NULL,
    "file_extension" VARCHAR(16),
    "mime_type" VARCHAR(255) NOT NULL,
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "checksum_sha256" VARCHAR(64),
    "content_version" INTEGER NOT NULL DEFAULT 1,
    "external_drive_id" TEXT NOT NULL,
    "external_item_id" TEXT,
    "external_etag" TEXT,
    "external_ctag" TEXT,
    "external_created_at" TIMESTAMPTZ(6),
    "external_last_modified_at" TIMESTAMPTZ(6),
    "upload_status" VARCHAR(30) NOT NULL DEFAULT 'pending',
    "uploaded_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(60),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,
    "recovery_attempts" SMALLINT NOT NULL DEFAULT 0,
    "next_recovery_at" TIMESTAMPTZ(6),
    "last_recovery_at" TIMESTAMPTZ(6),
    "last_recovery_outcome" VARCHAR(40),
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "review_reason" VARCHAR(80),
    "pending_size_bytes" BIGINT,
    "pending_checksum_sha256" VARCHAR(64),
    "recovery_lease_token" UUID,
    "recovery_lease_until" TIMESTAMPTZ(6),

    CONSTRAINT "central_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" BIGINT,
    "actor_user_id" BIGINT,
    "actor_type" VARCHAR(20) NOT NULL DEFAULT 'user',
    "action" VARCHAR(80) NOT NULL,
    "entity_type_id" BIGINT,
    "entity_id" BIGINT,
    "old_values" JSONB,
    "new_values" JSONB,
    "request_id" TEXT,
    "ip_address" INET,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "central_upload_slots" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "operation" VARCHAR(20) NOT NULL,
    "request_id" TEXT,
    "lease_token" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "released_at" TIMESTAMPTZ(6),
    "outcome" VARCHAR(20),

    CONSTRAINT "central_upload_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "sid_hash" BYTEA NOT NULL,
    "payload_ciphertext" BYTEA NOT NULL,
    "payload_nonce" BYTEA NOT NULL,
    "payload_auth_tag" BYTEA NOT NULL,
    "encryption_key_version" SMALLINT NOT NULL DEFAULT 1,
    "user_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("sid_hash")
);

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "ix_permissions_active" ON "permissions"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE INDEX "ix_role_permissions_active" ON "role_permissions"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE UNIQUE INDEX "uq_role_permission" ON "role_permissions"("role_id", "permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE INDEX "ix_roles_active" ON "roles"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_primary_identity" ON "user_identities"("user_id") WHERE (is_primary AND (NOT is_deleted));

-- CreateIndex
CREATE INDEX "ix_user_identities_user" ON "user_identities"("user_id") WHERE (NOT is_deleted);

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_identity_issuer_subject" ON "user_identities"("provider", "issuer", "subject");

-- CreateIndex
CREATE INDEX "ix_users_active" ON "users"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE UNIQUE INDEX "uq_users_provider_subject" ON "users"("auth_provider", "external_subject");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invitations_token_hash_key" ON "workspace_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "ix_workspace_invitations_active" ON "workspace_invitations"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE INDEX "ix_workspace_invitations_workspace" ON "workspace_invitations"("workspace_id");

-- CreateIndex
CREATE INDEX "ix_workspace_members_active" ON "workspace_members"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE INDEX "ix_workspace_members_workspace" ON "workspace_members"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_workspace_member" ON "workspace_members"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "ix_workspace_settings_active" ON "workspace_settings"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE INDEX "ix_workspace_settings_workspace" ON "workspace_settings"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_workspace_setting" ON "workspace_settings"("workspace_id", "setting_key");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE INDEX "ix_workspaces_active" ON "workspaces"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE UNIQUE INDEX "contact_source_types_code_key" ON "master"."contact_source_types"("code");

-- CreateIndex
CREATE INDEX "ix_contact_source_types_active" ON "master"."contact_source_types"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE UNIQUE INDEX "email_event_types_code_key" ON "master"."email_event_types"("code");

-- CreateIndex
CREATE INDEX "ix_email_event_types_active" ON "master"."email_event_types"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE UNIQUE INDEX "entity_types_code_key" ON "master"."entity_types"("code");

-- CreateIndex
CREATE INDEX "ix_entity_types_active" ON "master"."entity_types"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE UNIQUE INDEX "job_statuses_code_key" ON "master"."job_statuses"("code");

-- CreateIndex
CREATE INDEX "ix_job_statuses_active" ON "master"."job_statuses"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE UNIQUE INDEX "storage_provider_types_code_key" ON "master"."storage_provider_types"("code");

-- CreateIndex
CREATE INDEX "ix_storage_provider_types_active" ON "master"."storage_provider_types"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE UNIQUE INDEX "tool_types_code_key" ON "master"."tool_types"("code");

-- CreateIndex
CREATE INDEX "ix_tool_types_active" ON "master"."tool_types"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE UNIQUE INDEX "uq_default_storage_connection" ON "connections"("workspace_id") WHERE (is_default AND (NOT is_deleted));

-- CreateIndex
CREATE INDEX "ix_connections_active" ON "connections"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE INDEX "ix_connections_workspace" ON "connections"("workspace_id");

-- CreateIndex
CREATE INDEX "ix_storage_connections_owner" ON "connections"("owner_user_id") WHERE (NOT is_deleted);

-- CreateIndex
CREATE UNIQUE INDEX "uq_storage_connection_id_workspace" ON "connections"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "ix_file_links_active" ON "file_links"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE INDEX "ix_file_links_workspace" ON "file_links"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_file_link" ON "file_links"("workspace_id", "file_id", "entity_type_id", "entity_id");

-- CreateIndex
CREATE INDEX "ix_file_versions_active" ON "file_versions"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE UNIQUE INDEX "uq_file_version" ON "file_versions"("file_id", "version_number");

-- CreateIndex
CREATE INDEX "ix_files_active" ON "files"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE INDEX "ix_files_workspace" ON "files"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_external_file" ON "files"("connection_id", "external_object_id") WHERE (is_deleted = false);

-- CreateIndex
CREATE UNIQUE INDEX "uq_file_id_workspace" ON "files"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "ix_folder_mapping_workspace" ON "folder_mappings"("workspace_id") WHERE (NOT is_deleted);

-- CreateIndex
CREATE UNIQUE INDEX "uq_folder_mapping_active" ON "folder_mappings"("connection_id", "module_code") WHERE (NOT is_deleted);

-- CreateIndex
CREATE INDEX "ix_operations_active" ON "operations"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE INDEX "ix_operations_workspace" ON "operations"("workspace_id");

-- CreateIndex
CREATE INDEX "ix_system_admins_active" ON "system_admins"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE UNIQUE INDEX "uq_system_admins_user" ON "system_admins"("user_id") WHERE (is_deleted = false);

-- CreateIndex
CREATE INDEX "ix_central_connection_active" ON "central_connection"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE INDEX "ix_central_files_active" ON "central_files"("id") WHERE (is_deleted = false);

-- CreateIndex
CREATE INDEX "ix_central_files_owner" ON "central_files"("owner_user_id", "created_at" DESC) WHERE (is_deleted = false);

-- CreateIndex
CREATE INDEX "ix_central_files_created" ON "central_files"("created_at" DESC) WHERE (is_deleted = false);

-- CreateIndex
CREATE INDEX "ix_central_files_needs_attention" ON "central_files"("upload_status", "updated_at") WHERE upload_status IN ('pending', 'uploading', 'replacing', 'deleting', 'failed');

-- CreateIndex
CREATE INDEX "ix_central_files_recovery_due" ON "central_files"("next_recovery_at", "id") WHERE (upload_status IN ('pending', 'uploading', 'replacing', 'deleting', 'failed') AND (needs_review = false));

-- CreateIndex
CREATE INDEX "ix_central_files_review" ON "central_files"("updated_at" DESC) WHERE (needs_review = true);

-- CreateIndex
CREATE UNIQUE INDEX "uq_central_file_item" ON "central_files"("external_drive_id", "external_item_id") WHERE ((external_item_id IS NOT NULL) AND (is_deleted = false));

-- CreateIndex
CREATE UNIQUE INDEX "uq_central_file_stored_name" ON "central_files"("owner_user_id", "stored_name");

-- CreateIndex
CREATE INDEX "ix_central_upload_slots_user_recent" ON "central_upload_slots"("user_id", "operation", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_central_upload_slots_open" ON "central_upload_slots"("user_id", "lease_expires_at") WHERE (released_at IS NULL);

-- CreateIndex
CREATE INDEX "ix_central_upload_slots_created" ON "central_upload_slots"("created_at");

-- CreateIndex
CREATE INDEX "ix_sessions_expires" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "ix_sessions_user" ON "sessions"("user_id") WHERE (user_id IS NOT NULL);

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_provider_type_id_fkey" FOREIGN KEY ("provider_type_id") REFERENCES "master"."storage_provider_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "file_links" ADD CONSTRAINT "file_links_entity_type_id_fkey" FOREIGN KEY ("entity_type_id") REFERENCES "master"."entity_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "file_links" ADD CONSTRAINT "file_links_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "file_links" ADD CONSTRAINT "fk_file_link_workspace" FOREIGN KEY ("file_id", "workspace_id") REFERENCES "files"("id", "workspace_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "fk_file_connection_workspace" FOREIGN KEY ("connection_id", "workspace_id") REFERENCES "connections"("id", "workspace_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folder_mappings" ADD CONSTRAINT "fk_folder_mapping_connection_workspace" FOREIGN KEY ("connection_id", "workspace_id") REFERENCES "connections"("id", "workspace_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folder_mappings" ADD CONSTRAINT "folder_mappings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "system_admins" ADD CONSTRAINT "system_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "system_admins" ADD CONSTRAINT "system_admins_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "central_connection" ADD CONSTRAINT "central_connection_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "central_connection" ADD CONSTRAINT "central_connection_provider_type_id_fkey" FOREIGN KEY ("provider_type_id") REFERENCES "master"."storage_provider_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "central_files" ADD CONSTRAINT "central_files_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "central_connection"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "central_files" ADD CONSTRAINT "central_files_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "central_files" ADD CONSTRAINT "central_files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_entity_type_id_fkey" FOREIGN KEY ("entity_type_id") REFERENCES "master"."entity_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "central_upload_slots" ADD CONSTRAINT "central_upload_slots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- =====================================================================================================================
-- Hand-written part: everything Prisma cannot express. Prisma ignores these objects, so a later `migrate dev` never drops them.
-- Replaces the retired docs/database/sql files (full_schema_v1_1, central storage v1.2, hardening v1.3) on the two-schema layout:
-- "public" (application tables) and "master" (lookup tables).
-- =====================================================================================================================

-- ---------------------------------------------------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit rows are append-only'; END; $$;

-- Identity guard for the central OneDrive connection. INSERT: the Microsoft account must be an identity of owner_user_id.
-- UPDATE: owner, issuer, subject and drive can never change, so a different Microsoft account cannot silently take the connection
-- over. A deliberate replacement is: soft-delete the row, then insert a new one (by hand, reviewed).
CREATE OR REPLACE FUNCTION public.guard_central_connection_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_identities ui
      WHERE ui.user_id = NEW.owner_user_id
        AND ui.provider = 'microsoft'
        AND ui.issuer = NEW.account_issuer
        AND ui.subject = NEW.account_subject
        AND ui.is_deleted = false
    ) THEN
      RAISE EXCEPTION 'central_connection: the Microsoft account is not an identity of owner_user_id %', NEW.owner_user_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.account_issuer IS DISTINCT FROM OLD.account_issuer
     OR NEW.account_subject IS DISTINCT FROM OLD.account_subject
     OR NEW.external_drive_id IS DISTINCT FROM OLD.external_drive_id THEN
    RAISE EXCEPTION 'central_connection: the designated Microsoft account and drive cannot be changed on an existing connection'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Column rule Prisma cannot express: a list column that is NOT NULL (Prisma only generates the default).
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE "central_connection" ALTER COLUMN "consented_scopes" SET NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------------
-- Indexes Prisma cannot express (expression / constant keys)
-- ---------------------------------------------------------------------------------------------------------------------
-- One live user per e-mail address, case-insensitive.
CREATE UNIQUE INDEX "uq_users_email_lower" ON "users"(lower("email")) WHERE "is_deleted" = false;
-- Exactly one live (not soft-deleted) central connection.
CREATE UNIQUE INDEX "uq_central_connection_single" ON "central_connection"((true)) WHERE "is_deleted" = false;

-- ---------------------------------------------------------------------------------------------------------------------
-- CHECK constraints (66)
-- ---------------------------------------------------------------------------------------------------------------------
-- master.contact_source_types
ALTER TABLE "master"."contact_source_types" ADD CONSTRAINT "contact_source_types_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));

-- master.email_event_types
ALTER TABLE "master"."email_event_types" ADD CONSTRAINT "email_event_types_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));

-- master.entity_types
ALTER TABLE "master"."entity_types" ADD CONSTRAINT "entity_types_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));

-- master.job_statuses
ALTER TABLE "master"."job_statuses" ADD CONSTRAINT "job_statuses_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));

-- master.storage_provider_types
ALTER TABLE "master"."storage_provider_types" ADD CONSTRAINT "storage_provider_types_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));

-- master.tool_types
ALTER TABLE "master"."tool_types" ADD CONSTRAINT "tool_types_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));

-- public.central_connection
ALTER TABLE "central_connection" ADD CONSTRAINT "central_connection_account_type_check" CHECK (((account_type)::text = ANY ((ARRAY['personal'::character varying, 'organizational'::character varying, 'unknown'::character varying])::text[])));
ALTER TABLE "central_connection" ADD CONSTRAINT "central_connection_cache_not_empty" CHECK ((octet_length(token_cache_ciphertext) > 0));
ALTER TABLE "central_connection" ADD CONSTRAINT "central_connection_connection_status_check" CHECK (((connection_status)::text = ANY ((ARRAY['unverified'::character varying, 'connected'::character varying, 'reauth_required'::character varying, 'revoked'::character varying, 'error'::character varying])::text[])));
ALTER TABLE "central_connection" ADD CONSTRAINT "central_connection_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));
ALTER TABLE "central_connection" ADD CONSTRAINT "central_connection_key_version" CHECK ((encryption_key_version > 0));
ALTER TABLE "central_connection" ADD CONSTRAINT "central_connection_nonce_length" CHECK ((octet_length(token_cache_nonce) = 12));
ALTER TABLE "central_connection" ADD CONSTRAINT "central_connection_quota_remaining_bytes_check" CHECK ((quota_remaining_bytes >= 0));
ALTER TABLE "central_connection" ADD CONSTRAINT "central_connection_quota_total_bytes_check" CHECK ((quota_total_bytes >= 0));
ALTER TABLE "central_connection" ADD CONSTRAINT "central_connection_quota_used_bytes_check" CHECK ((quota_used_bytes >= 0));
ALTER TABLE "central_connection" ADD CONSTRAINT "central_connection_revision" CHECK ((cache_revision > 0));
ALTER TABLE "central_connection" ADD CONSTRAINT "central_connection_root_not_personal" CHECK ((lower(root_folder_path) <> 'fileforge'::text));
ALTER TABLE "central_connection" ADD CONSTRAINT "central_connection_tag_length" CHECK ((octet_length(token_cache_auth_tag) = 16));

-- public.central_files
ALTER TABLE "central_files" ADD CONSTRAINT "central_files_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));
ALTER TABLE "central_files" ADD CONSTRAINT "central_files_deleted_states" CHECK ((((upload_status)::text <> ALL ((ARRAY['deleting'::character varying, 'deleted'::character varying])::text[])) OR (is_deleted = true)));
ALTER TABLE "central_files" ADD CONSTRAINT "central_files_display_name_length" CHECK (((char_length(display_name) >= 1) AND (char_length(display_name) <= 255)));
ALTER TABLE "central_files" ADD CONSTRAINT "central_files_extension_format" CHECK (((file_extension IS NULL) OR ((file_extension)::text ~ '^[a-z0-9]{1,16}$'::text)));
ALTER TABLE "central_files" ADD CONSTRAINT "central_files_pending_size_check" CHECK (((pending_size_bytes IS NULL) OR (pending_size_bytes >= 0)));
ALTER TABLE "central_files" ADD CONSTRAINT "central_files_ready_has_item" CHECK ((((upload_status)::text <> ALL ((ARRAY['ready'::character varying, 'replacing'::character varying])::text[])) OR ((external_item_id IS NOT NULL) AND (uploaded_at IS NOT NULL))));
ALTER TABLE "central_files" ADD CONSTRAINT "central_files_recovery_attempts_check" CHECK ((recovery_attempts >= 0));
ALTER TABLE "central_files" ADD CONSTRAINT "central_files_recovery_lease" CHECK (((recovery_lease_token IS NULL) = (recovery_lease_until IS NULL)));
ALTER TABLE "central_files" ADD CONSTRAINT "central_files_recovery_outcome" CHECK (((last_recovery_outcome IS NULL) OR ((last_recovery_outcome)::text = ANY ((ARRAY['repaired'::character varying, 'retry_scheduled'::character varying, 'needs_review'::character varying, 'reauth_required'::character varying, 'no_action'::character varying, 'failed'::character varying])::text[]))));
ALTER TABLE "central_files" ADD CONSTRAINT "central_files_review_reason" CHECK (((needs_review = false) OR (review_reason IS NOT NULL)));
ALTER TABLE "central_files" ADD CONSTRAINT "central_files_size_check" CHECK ((size_bytes >= 0));
ALTER TABLE "central_files" ADD CONSTRAINT "central_files_status_check" CHECK (((upload_status)::text = ANY ((ARRAY['pending'::character varying, 'uploading'::character varying, 'ready'::character varying, 'replacing'::character varying, 'failed'::character varying, 'deleting'::character varying, 'deleted'::character varying])::text[])));
ALTER TABLE "central_files" ADD CONSTRAINT "central_files_stored_name_format" CHECK (((stored_name)::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,16})?$'::text));
ALTER TABLE "central_files" ADD CONSTRAINT "central_files_version_check" CHECK ((content_version > 0));

-- public.central_upload_slots
ALTER TABLE "central_upload_slots" ADD CONSTRAINT "central_upload_slots_operation_check" CHECK (((operation)::text = ANY ((ARRAY['upload'::character varying, 'replace'::character varying, 'admin_upload'::character varying])::text[])));
ALTER TABLE "central_upload_slots" ADD CONSTRAINT "central_upload_slots_outcome_check" CHECK (((outcome IS NULL) OR ((outcome)::text = ANY ((ARRAY['completed'::character varying, 'failed'::character varying, 'cancelled'::character varying, 'expired'::character varying])::text[]))));
ALTER TABLE "central_upload_slots" ADD CONSTRAINT "central_upload_slots_release_consistency" CHECK ((((released_at IS NULL) AND (outcome IS NULL)) OR ((released_at IS NOT NULL) AND (outcome IS NOT NULL))));

-- public.connections
ALTER TABLE "connections" ADD CONSTRAINT "connections_auth_mode_check" CHECK (((auth_mode)::text = ANY ((ARRAY['provider_specific'::character varying, 'delegated'::character varying, 'application'::character varying, 'managed_identity'::character varying])::text[])));
ALTER TABLE "connections" ADD CONSTRAINT "connections_connection_status_check" CHECK (((connection_status)::text = ANY ((ARRAY['unverified'::character varying, 'connected'::character varying, 'reauth_required'::character varying, 'revoked'::character varying, 'error'::character varying])::text[])));
ALTER TABLE "connections" ADD CONSTRAINT "connections_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));

-- public.file_links
ALTER TABLE "file_links" ADD CONSTRAINT "file_links_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));

-- public.file_versions
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_size_bytes_check" CHECK ((size_bytes >= 0));
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_version_number_check" CHECK ((version_number > 0));

-- public.files
ALTER TABLE "files" ADD CONSTRAINT "files_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));
ALTER TABLE "files" ADD CONSTRAINT "files_size_bytes_check" CHECK ((size_bytes >= 0));
ALTER TABLE "files" ADD CONSTRAINT "files_upload_status_check" CHECK (((upload_status)::text = ANY ((ARRAY['pending'::character varying, 'uploading'::character varying, 'ready'::character varying, 'failed'::character varying, 'deleted'::character varying])::text[])));

-- public.folder_mappings
ALTER TABLE "folder_mappings" ADD CONSTRAINT "folder_mappings_delete_consistency" CHECK ((((NOT is_deleted) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR (is_deleted AND (deleted_at IS NOT NULL))));

-- public.operations
ALTER TABLE "operations" ADD CONSTRAINT "operations_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));

-- public.permissions
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));

-- public.role_permissions
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));

-- public.roles
ALTER TABLE "roles" ADD CONSTRAINT "roles_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));

-- public.sessions
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_key_version" CHECK ((encryption_key_version > 0));
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_nonce_length" CHECK ((octet_length(payload_nonce) = 12));
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_payload_not_empty" CHECK ((octet_length(payload_ciphertext) > 0));
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_sid_hash_length" CHECK ((octet_length(sid_hash) = 32));
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tag_length" CHECK ((octet_length(payload_auth_tag) = 16));

-- public.system_admins
ALTER TABLE "system_admins" ADD CONSTRAINT "system_admins_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));

-- public.user_identities
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_account_type_check" CHECK (((account_type)::text = ANY ((ARRAY['personal'::character varying, 'organizational'::character varying, 'unknown'::character varying])::text[])));
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_delete_consistency" CHECK ((((NOT is_deleted) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR (is_deleted AND (deleted_at IS NOT NULL))));
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_provider_check" CHECK (((provider)::text = ANY ((ARRAY['microsoft'::character varying, 'local'::character varying, 'other'::character varying])::text[])));

-- public.users
ALTER TABLE "users" ADD CONSTRAINT "users_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));

-- public.workspace_invitations
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));

-- public.workspace_members
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_membership_status_check" CHECK (((membership_status)::text = ANY ((ARRAY['invited'::character varying, 'active'::character varying, 'suspended'::character varying, 'left'::character varying])::text[])));

-- public.workspace_settings
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));

-- public.workspaces
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_delete_consistency" CHECK ((((is_deleted = false) AND (deleted_at IS NULL) AND (deleted_by IS NULL)) OR ((is_deleted = true) AND (deleted_at IS NOT NULL))));
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_workspace_type_check" CHECK (((workspace_type)::text = ANY ((ARRAY['personal'::character varying, 'team'::character varying])::text[])));

-- ---------------------------------------------------------------------------------------------------------------------
-- Triggers (26): updated_at on every table that has the column, append-only audit events, central connection guard
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TRIGGER trg_contact_source_types_updated_at BEFORE UPDATE ON master.contact_source_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_email_event_types_updated_at BEFORE UPDATE ON master.email_event_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_entity_types_updated_at BEFORE UPDATE ON master.entity_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_job_statuses_updated_at BEFORE UPDATE ON master.job_statuses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_storage_provider_types_updated_at BEFORE UPDATE ON master.storage_provider_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_tool_types_updated_at BEFORE UPDATE ON master.tool_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_central_connection_identity BEFORE INSERT OR UPDATE ON public.central_connection FOR EACH ROW EXECUTE FUNCTION public.guard_central_connection_identity();
CREATE TRIGGER trg_central_connection_updated_at BEFORE UPDATE ON public.central_connection FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_central_files_updated_at BEFORE UPDATE ON public.central_files FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_connections_updated_at BEFORE UPDATE ON public.connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER audit_events_immutable BEFORE DELETE OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();
CREATE TRIGGER trg_file_links_updated_at BEFORE UPDATE ON public.file_links FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_file_versions_updated_at BEFORE UPDATE ON public.file_versions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_files_updated_at BEFORE UPDATE ON public.files FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_folder_mappings_updated_at BEFORE UPDATE ON public.folder_mappings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_operations_updated_at BEFORE UPDATE ON public.operations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_permissions_updated_at BEFORE UPDATE ON public.permissions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_role_permissions_updated_at BEFORE UPDATE ON public.role_permissions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_system_admins_updated_at BEFORE UPDATE ON public.system_admins FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_user_identities_updated_at BEFORE UPDATE ON public.user_identities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_workspace_invitations_updated_at BEFORE UPDATE ON public.workspace_invitations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_workspace_members_updated_at BEFORE UPDATE ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_workspace_settings_updated_at BEFORE UPDATE ON public.workspace_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_workspaces_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------------------------------------------------
-- Seed rows. Lookup data the application requires (the API refuses to provision a user if the "owner" role is missing).
-- core.system_admins is deliberately NOT seeded: grant it per environment with prisma/grant-system-admin.sql.
-- ---------------------------------------------------------------------------------------------------------------------
INSERT INTO master.storage_provider_types(code, name) VALUES
  ('azure_blob', 'Azure Blob Storage'), ('sharepoint', 'Microsoft SharePoint'), ('onedrive', 'Microsoft OneDrive'), ('cloudflare_r2', 'Cloudflare R2');
INSERT INTO master.tool_types(code, name) VALUES
  ('business_card', 'AI Business Card Scanner'), ('qr', 'QR Extraction'), ('scraper', 'Web Scraper'), ('pdf', 'PDF Extraction'),
  ('email_analysis', 'Email Analysis'), ('email_campaign', 'Bulk Email'), ('invoice', 'Invoice Generator'), ('receipt', 'Payment Receipt'), ('export', 'Data Export');
INSERT INTO master.job_statuses(code, label, is_terminal) VALUES
  ('pending', 'Pending', false), ('queued', 'Queued', false), ('running', 'Running', false), ('review', 'Awaiting Review', false),
  ('completed', 'Completed', true), ('failed', 'Failed', true), ('cancelled', 'Cancelled', true);
INSERT INTO master.entity_types(code, name, description) VALUES
  ('contact', 'Contact', NULL), ('business_card_scan', 'Business Card Scan', NULL), ('qr_item', 'QR Item', NULL), ('scraper_record', 'Scraper Record', NULL),
  ('document', 'Document', NULL), ('email_message', 'Email Message', NULL), ('invoice', 'Invoice', NULL), ('payment', 'Payment', NULL), ('file', 'File', NULL),
  ('central_file', 'Central storage file', 'A file stored in the centralized administrator-owned OneDrive'),
  ('central_storage_connection', 'Central storage connection', 'The designated central OneDrive connection');
INSERT INTO master.contact_source_types(code, label) VALUES
  ('manual', 'Manual'), ('business_card', 'Business Card'), ('qr', 'QR Code'), ('scraper', 'Web Scraper'), ('email', 'Email'), ('import', 'Import');
INSERT INTO master.email_event_types(code, label) VALUES
  ('queued', 'Queued'), ('sent', 'Sent'), ('delivered', 'Delivered'), ('bounced', 'Bounced'), ('failed', 'Failed'),
  ('opened', 'Opened'), ('clicked', 'Clicked'), ('unsubscribed', 'Unsubscribed');
INSERT INTO "roles"(code, label) VALUES
  ('owner', 'Owner'), ('admin', 'Administrator'), ('editor', 'Editor'), ('viewer', 'Viewer');
