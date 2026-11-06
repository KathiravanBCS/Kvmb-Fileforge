import { Module } from '@nestjs/common';

import { UserProvisioningService } from './user-provisioning.service';

@Module({
  providers: [UserProvisioningService],
  exports: [UserProvisioningService],
})
export class UsersModule {}
