import { Controller, Get } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';

import { SESSION_SECURITY_SCHEME } from '../../app.swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { SessionUser } from '../../common/types/session.types';
import { WorkspacesService, type WorkspaceSummary } from './workspaces.service';

class WorkspaceSummaryDto implements WorkspaceSummary {
  @ApiProperty({ example: '1', description: 'BIGINT as a decimal string.' })
  id: string;

  @ApiProperty({ example: 'Ada’s workspace' })
  name: string;

  @ApiProperty({ example: 'personal', description: 'personal | team' })
  type: string;

  @ApiProperty({ example: 'owner', description: 'Your role code in this workspace (core.roles).' })
  role: string;
}

@ApiTags('workspaces')
@ApiCookieAuth(SESSION_SECURITY_SCHEME)
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @ApiOperation({ summary: 'Workspaces you belong to, with your role in each' })
  @ApiResponse({ status: 200, type: [WorkspaceSummaryDto] })
  @Get()
  list(@CurrentUser() user: SessionUser): Promise<WorkspaceSummary[]> {
    return this.workspaces.listForUser(user.id);
  }
}
