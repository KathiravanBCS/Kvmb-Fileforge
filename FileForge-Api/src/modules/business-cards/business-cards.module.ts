import { Module } from '@nestjs/common';

import { CentralStorageModule } from '../central-storage/central-storage.module';
import { ContactsModule } from '../contacts/contacts.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { BusinessCardExtractorService } from './business-card-extractor.service';
import { BusinessCardsController } from './business-cards.controller';
import { BusinessCardsService } from './business-cards.service';

/**
 * Business card scanning. Photos are kept in central storage (the administrator's OneDrive), the card is read by a Groq vision
 * model, and an approved card becomes a centralized contact linked back to the scan.
 */
@Module({
  imports: [CentralStorageModule, ContactsModule, WorkspacesModule],
  controllers: [BusinessCardsController],
  providers: [BusinessCardsService, BusinessCardExtractorService],
})
export class BusinessCardsModule {}
