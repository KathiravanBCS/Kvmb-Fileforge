import type { Request } from 'express';

import { Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { SESSION_SECURITY_SCHEME } from '../../app.swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { SessionUser } from '../../common/types/session.types';
import {
  CentralRecoveryAdminService,
  type RecoveryEventView,
  type RecoveryItemView,
  type RecoverySummaryView,
} from './central-recovery-admin.service';
import { CentralStorageAccessService } from './central-storage-access.service';
import { parseWith, requestMeta } from './central-storage.http';
import {
  RecoveryActionResultDto,
  RecoveryDetailDto,
  recoveryListQuerySchema,
  RecoveryPageDto,
  RecoverySummaryDto,
} from './dto/central-recovery.dto';
import { SystemAdminGuard } from './guards/system-admin.guard';

/**
 * Interrupted-operation recovery, for system administrators only (checked against the database on every request).
 * The page lists what needs attention and offers two actions: retry now, and mark as reviewed. Neither ever deletes
 * anything from OneDrive except finishing a delete that the owner or an administrator already asked for.
 */
@ApiTags('admin-central-storage-recovery')
@ApiCookieAuth(SESSION_SECURITY_SCHEME)
@Controller('admin/central-storage/recovery')
@UseGuards(SystemAdminGuard)
export class CentralRecoveryAdminController {
  constructor(
    private readonly recovery: CentralRecoveryAdminService,
    private readonly access: CentralStorageAccessService,
  ) {}

  private actor(user: SessionUser, req: Request) {
    return this.access.adminActor(user, requestMeta(req));
  }

  @ApiOperation({ summary: 'Counts for the recovery dashboard and the worker settings' })
  @ApiResponse({ status: 200, type: RecoverySummaryDto })
  @Get('summary')
  async summary(@CurrentUser() user: SessionUser, @Req() req: Request): Promise<RecoverySummaryView> {
    return this.recovery.summary(await this.actor(user, req));
  }

  @ApiOperation({ summary: 'Files that need attention (needs review / being retried / waiting), paginated' })
  @ApiResponse({ status: 200, type: RecoveryPageDto })
  @Get('items')
  async list(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Query() query: unknown,
  ): Promise<{ items: RecoveryItemView[]; page: number; pageSize: number; total: number }> {
    return this.recovery.list(await this.actor(user, req), parseWith(recoveryListQuerySchema, query));
  }

  @ApiOperation({ summary: 'One file: what happened, what is planned, and its recovery history' })
  @ApiResponse({ status: 200, type: RecoveryDetailDto })
  @Get('items/:id')
  async detail(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ item: RecoveryItemView; events: RecoveryEventView[] }> {
    return this.recovery.detail(await this.actor(user, req), id);
  }

  @ApiOperation({
    summary: 'Recover this file now',
    description: 'Runs the same checks as the worker immediately, ignoring its schedule and an earlier "needs review".',
  })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 200, type: RecoveryActionResultDto })
  @Post('items/:id/retry')
  @HttpCode(200)
  async retry(@CurrentUser() user: SessionUser, @Req() req: Request, @Param('id') id: string) {
    return this.recovery.retry(await this.actor(user, req), id);
  }

  @ApiOperation({
    summary: 'Mark a file as reviewed',
    description: 'Takes it out of the review queue as it is. Changes nothing in OneDrive.',
  })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 200, type: RecoveryActionResultDto })
  @Post('items/:id/dismiss')
  @HttpCode(200)
  async dismiss(@CurrentUser() user: SessionUser, @Req() req: Request, @Param('id') id: string) {
    return this.recovery.dismiss(await this.actor(user, req), id);
  }
}
