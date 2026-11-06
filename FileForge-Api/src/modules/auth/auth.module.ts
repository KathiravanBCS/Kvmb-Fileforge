import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { CentralStorageModule } from '../central-storage/central-storage.module';
import { MicrosoftModule } from '../microsoft/microsoft.module';
import { StorageModule } from '../storage/storage.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './controllers/auth.controller';
import { AuthenticatedGuard } from './guards/authenticated.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { MicrosoftLoginService } from './services/microsoft-login.service';
import { SessionService } from './services/session.service';

@Module({
  // StorageModule: the one Microsoft redirect URI also completes Connect OneDrive, which lives in storage.
  // CentralStorageModule: the same redirect also completes "connect central storage" (administrator only).
  imports: [MicrosoftModule, UsersModule, StorageModule, CentralStorageModule],
  controllers: [AuthController],
  providers: [
    MicrosoftLoginService,
    SessionService,
    // Global and in this order: first "is there a session?", then "is the CSRF token valid?".
    { provide: APP_GUARD, useClass: AuthenticatedGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AuthModule {}
