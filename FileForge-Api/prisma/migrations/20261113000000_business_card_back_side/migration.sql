-- AlterTable
ALTER TABLE "business_card_scans" ADD COLUMN     "back_central_file_id" BIGINT;
-- CreateIndex
CREATE INDEX "ix_business_card_scans_back_file" ON "business_card_scans"("back_central_file_id") WHERE (back_central_file_id IS NOT NULL);
-- AddForeignKey
ALTER TABLE "business_card_scans" ADD CONSTRAINT "business_card_scans_back_central_file_id_fkey" FOREIGN KEY ("back_central_file_id") REFERENCES "central_files"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- =====================================================================================================================
-- Hand-written part (Prisma cannot express CHECK constraints).
-- =====================================================================================================================

-- The back of a card is a different photo than the front.
ALTER TABLE "business_card_scans" ADD CONSTRAINT "business_card_scans_back_differs_from_front" CHECK (back_central_file_id IS NULL OR back_central_file_id <> central_file_id);
