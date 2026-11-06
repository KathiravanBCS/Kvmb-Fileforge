import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { Logger, Module, OnModuleInit } from '@nestjs/common';

import { MicrosoftModule } from '../microsoft/microsoft.module';
import { CentralConnectionService } from './central-connection.service';
import { CentralRecoveryAdminController } from './central-recovery-admin.controller';
import { CentralRecoveryAdminService } from './central-recovery-admin.service';
import { CentralRecoveryService } from './central-recovery.service';
import { CentralRecoveryWorker } from './central-recovery.worker';
import { CentralStorageAccessService } from './central-storage-access.service';
import { CentralStorageAdminController } from './central-storage-admin.controller';
import { CentralStorageAdminService } from './central-storage-admin.service';
import { CentralStorageAuditService } from './central-storage-audit.service';
import { CentralStorageOneDriveService } from './central-storage-onedrive.service';
import { CentralStorageController } from './central-storage.controller';
import { UPLOAD_TMP_DIR } from './central-storage.http';
import { CentralStorageService } from './central-storage.service';
import { CentralTokenVault } from './central-token-vault.service';
import { CentralUploadAdmissionService } from './central-upload-admission.service';
import { SystemAdminGuard } from './guards/system-admin.guard';
import { UploadAdmissionGuard } from './guards/upload-admission.guard';

/** Temporary upload files older than this are leftovers from an interrupted request and are removed at startup. */
const STALE_TEMP_MS = 60 * 60 * 1000;

/**
 * Central storage: all users' files in the administrator's OneDrive, with ownership enforced here. Independent of the
 * personal OneDrive File Manager (StorageModule). Depends only on the Microsoft module; the Auth module imports this one
 * so the single Microsoft redirect can also complete "connect central storage".
 */
@Module({
  imports: [MicrosoftModule],
  controllers: [CentralStorageController, CentralStorageAdminController, CentralRecoveryAdminController],
  providers: [
    CentralTokenVault,
    CentralStorageOneDriveService,
    CentralStorageAccessService,
    CentralStorageAuditService,
    CentralStorageService,
    CentralStorageAdminService,
    CentralConnectionService,
    SystemAdminGuard,
    CentralUploadAdmissionService,
    UploadAdmissionGuard,
    CentralRecoveryService,
    CentralRecoveryAdminService,
    CentralRecoveryWorker,
  ],
  exports: [CentralConnectionService],
})
export class CentralStorageModule implements OnModuleInit {
  private readonly logger = new Logger(CentralStorageModule.name);

  async onModuleInit(): Promise<void> {
    try {
      await mkdir(UPLOAD_TMP_DIR, { recursive: true, mode: 0o700 });
      for (const name of await readdir(UPLOAD_TMP_DIR)) {
        const path = join(UPLOAD_TMP_DIR, name);
        const { mtimeMs } = await stat(path);
        if (Date.now() - mtimeMs > STALE_TEMP_MS) await rm(path, { force: true });
      }
    } catch {
      // Uploads fail with a clear error if the folder is unusable; this must not stop the API from starting.
      this.logger.warn({ event: 'central_upload_tmp_dir_unavailable' });
    }
  }
}
