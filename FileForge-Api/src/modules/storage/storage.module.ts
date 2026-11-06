import { Module } from '@nestjs/common';

import { MicrosoftModule } from '../microsoft/microsoft.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { OneDriveConnectionService } from './onedrive/onedrive-connection.service';
import { OneDriveFilesService } from './onedrive/onedrive-files.service';
import { OneDriveController } from './onedrive/onedrive.controller';

/** Workspace storage. Depends on microsoft and workspaces; the Auth module uses it to finish Connect OneDrive. */
@Module({
  imports: [MicrosoftModule, WorkspacesModule],
  controllers: [OneDriveController],
  providers: [OneDriveConnectionService, OneDriveFilesService],
  exports: [OneDriveConnectionService],
})
export class StorageModule {}
