import { Module } from '@nestjs/common';

import { SessionStoreService } from './session-store.service';

@Module({ providers: [SessionStoreService], exports: [SessionStoreService] })
export class SessionModule {}
