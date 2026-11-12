import { Module } from '@nestjs/common';

import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';

/** The centralized contacts. Other modules (business cards first) import this and hand people over with `saveFromSource`. */
@Module({
  imports: [WorkspacesModule],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
