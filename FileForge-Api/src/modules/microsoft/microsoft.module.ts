import { Module } from '@nestjs/common';

import { GraphClient } from './graph/graph.client';
import { MicrosoftIdentityService } from './identity/microsoft-identity.service';
import { OAuthTransactionStore } from './identity/oauth-transaction.store';

/** Microsoft integrations. Depends on nothing in the Auth module (Auth depends on this one). */
@Module({
  providers: [MicrosoftIdentityService, GraphClient, OAuthTransactionStore],
  exports: [MicrosoftIdentityService, GraphClient, OAuthTransactionStore],
})
export class MicrosoftModule {}
