-- CreateTable
CREATE TABLE "contacts" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" BIGINT NOT NULL,
    "display_name" VARCHAR(240) NOT NULL,
    "first_name" VARCHAR(120),
    "last_name" VARCHAR(120),
    "organization" VARCHAR(240),
    "job_title" VARCHAR(180),
    "department" VARCHAR(180),
    "notes" TEXT,
    "source_type_id" BIGINT,
    "source_record_id" BIGINT,
    "review_status" VARCHAR(25) NOT NULL DEFAULT 'unreviewed',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,
    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "contact_methods" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" BIGINT NOT NULL,
    "contact_id" BIGINT NOT NULL,
    "method_type" VARCHAR(25) NOT NULL,
    "label" VARCHAR(40),
    "value" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,
    CONSTRAINT "contact_methods_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "contact_addresses" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" BIGINT NOT NULL,
    "contact_id" BIGINT NOT NULL,
    "address_type" VARCHAR(30),
    "line1" TEXT,
    "city" VARCHAR(120),
    "region" VARCHAR(120),
    "postal_code" VARCHAR(30),
    "country" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,
    CONSTRAINT "contact_addresses_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "contact_entity_links" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" BIGINT NOT NULL,
    "contact_id" BIGINT NOT NULL,
    "entity_type_id" BIGINT NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "relationship_type" VARCHAR(60) NOT NULL DEFAULT 'source',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,
    CONSTRAINT "contact_entity_links_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "business_card_scans" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" BIGINT NOT NULL,
    "owner_user_id" BIGINT NOT NULL,
    "central_file_id" BIGINT NOT NULL,
    "contact_id" BIGINT,
    "raw_extraction" JSONB NOT NULL DEFAULT '{}',
    "normalized_data" JSONB NOT NULL DEFAULT '{}',
    "extraction_model" VARCHAR(100) NOT NULL,
    "review_status" VARCHAR(25) NOT NULL DEFAULT 'pending',
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" BIGINT,
    CONSTRAINT "business_card_scans_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "ix_contacts_workspace" ON "contacts"("workspace_id", "id" DESC) WHERE (NOT is_deleted);
-- CreateIndex
CREATE UNIQUE INDEX "uq_contact_id_workspace" ON "contacts"("id", "workspace_id");
-- CreateIndex
CREATE INDEX "ix_contact_methods_contact" ON "contact_methods"("contact_id") WHERE (NOT is_deleted);
-- CreateIndex
CREATE INDEX "ix_contact_methods_lookup" ON "contact_methods"("workspace_id", "method_type", "value") WHERE (NOT is_deleted);
-- CreateIndex
CREATE INDEX "ix_contact_addresses_contact" ON "contact_addresses"("contact_id") WHERE (NOT is_deleted);
-- CreateIndex
CREATE INDEX "ix_contact_entity_links_entity" ON "contact_entity_links"("entity_type_id", "entity_id");
-- CreateIndex
CREATE UNIQUE INDEX "uq_contact_entity_link" ON "contact_entity_links"("workspace_id", "contact_id", "entity_type_id", "entity_id", "relationship_type");
-- CreateIndex
CREATE INDEX "ix_business_card_scans_owner" ON "business_card_scans"("workspace_id", "owner_user_id", "id" DESC) WHERE (NOT is_deleted);
-- CreateIndex
CREATE INDEX "ix_business_card_scans_file" ON "business_card_scans"("central_file_id");
-- CreateIndex
CREATE INDEX "ix_business_card_scans_contact" ON "business_card_scans"("contact_id") WHERE (contact_id IS NOT NULL);
-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_source_type_id_fkey" FOREIGN KEY ("source_type_id") REFERENCES "master"."contact_source_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
-- AddForeignKey
ALTER TABLE "contact_methods" ADD CONSTRAINT "contact_methods_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
-- AddForeignKey
ALTER TABLE "contact_methods" ADD CONSTRAINT "fk_contact_method_workspace" FOREIGN KEY ("contact_id", "workspace_id") REFERENCES "contacts"("id", "workspace_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
-- AddForeignKey
ALTER TABLE "contact_addresses" ADD CONSTRAINT "contact_addresses_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
-- AddForeignKey
ALTER TABLE "contact_addresses" ADD CONSTRAINT "fk_contact_address_workspace" FOREIGN KEY ("contact_id", "workspace_id") REFERENCES "contacts"("id", "workspace_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
-- AddForeignKey
ALTER TABLE "contact_entity_links" ADD CONSTRAINT "contact_entity_links_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
-- AddForeignKey
ALTER TABLE "contact_entity_links" ADD CONSTRAINT "contact_entity_links_entity_type_id_fkey" FOREIGN KEY ("entity_type_id") REFERENCES "master"."entity_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
-- AddForeignKey
ALTER TABLE "contact_entity_links" ADD CONSTRAINT "fk_entity_contact_workspace" FOREIGN KEY ("contact_id", "workspace_id") REFERENCES "contacts"("id", "workspace_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
-- AddForeignKey
ALTER TABLE "business_card_scans" ADD CONSTRAINT "business_card_scans_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
-- AddForeignKey
ALTER TABLE "business_card_scans" ADD CONSTRAINT "business_card_scans_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
-- AddForeignKey
ALTER TABLE "business_card_scans" ADD CONSTRAINT "business_card_scans_central_file_id_fkey" FOREIGN KEY ("central_file_id") REFERENCES "central_files"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
-- AddForeignKey
ALTER TABLE "business_card_scans" ADD CONSTRAINT "business_card_scans_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- =====================================================================================================================
-- Hand-written part: CHECK constraints and updated_at triggers (Prisma cannot express them; it ignores them in later diffs).
-- =====================================================================================================================

-- contacts
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_delete_consistency" CHECK ((is_deleted = false AND deleted_at IS NULL AND deleted_by IS NULL) OR (is_deleted = true AND deleted_at IS NOT NULL));
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_review_status_check" CHECK (review_status IN ('unreviewed', 'reviewed', 'rejected'));
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_display_name_not_blank" CHECK (char_length(btrim(display_name)) > 0);

-- contact_methods
ALTER TABLE "contact_methods" ADD CONSTRAINT "contact_methods_delete_consistency" CHECK ((is_deleted = false AND deleted_at IS NULL AND deleted_by IS NULL) OR (is_deleted = true AND deleted_at IS NOT NULL));
ALTER TABLE "contact_methods" ADD CONSTRAINT "contact_methods_method_type_check" CHECK (method_type IN ('email', 'phone', 'website', 'social'));
ALTER TABLE "contact_methods" ADD CONSTRAINT "contact_methods_value_not_blank" CHECK (char_length(btrim(value)) > 0);

-- contact_addresses
ALTER TABLE "contact_addresses" ADD CONSTRAINT "contact_addresses_delete_consistency" CHECK ((is_deleted = false AND deleted_at IS NULL AND deleted_by IS NULL) OR (is_deleted = true AND deleted_at IS NOT NULL));

-- contact_entity_links
ALTER TABLE "contact_entity_links" ADD CONSTRAINT "contact_entity_links_delete_consistency" CHECK ((is_deleted = false AND deleted_at IS NULL AND deleted_by IS NULL) OR (is_deleted = true AND deleted_at IS NOT NULL));

-- business_card_scans
ALTER TABLE "business_card_scans" ADD CONSTRAINT "business_card_scans_delete_consistency" CHECK ((is_deleted = false AND deleted_at IS NULL AND deleted_by IS NULL) OR (is_deleted = true AND deleted_at IS NOT NULL));
ALTER TABLE "business_card_scans" ADD CONSTRAINT "business_card_scans_review_status_check" CHECK (review_status IN ('pending', 'approved', 'rejected'));
-- An approved scan always points at the contact it created or updated.
ALTER TABLE "business_card_scans" ADD CONSTRAINT "business_card_scans_approved_has_contact" CHECK (review_status <> 'approved' OR contact_id IS NOT NULL);

-- updated_at triggers (same convention as every other table)
CREATE TRIGGER trg_contacts_updated_at BEFORE UPDATE ON "contacts" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_contact_methods_updated_at BEFORE UPDATE ON "contact_methods" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_contact_addresses_updated_at BEFORE UPDATE ON "contact_addresses" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_contact_entity_links_updated_at BEFORE UPDATE ON "contact_entity_links" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_business_card_scans_updated_at BEFORE UPDATE ON "business_card_scans" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
