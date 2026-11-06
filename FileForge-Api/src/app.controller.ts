import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AppService } from './app.services';
import { Public } from './common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({ summary: 'Liveness check (does not touch the database)' })
  @Public()
  @Get('live')
  getHealth(): { status: string } {
    return this.appService.getHealth();
  }
}
