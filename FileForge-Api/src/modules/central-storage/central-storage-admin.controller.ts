import { rm } from 'node:fs/promises';

import type { Request, Response } from 'express';

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { SESSION_SECURITY_SCHEME } from '../../app.swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { SessionUser } from '../../common/types/session.types';
import { CentralConnectionService, type CentralConnectionStatus } from './central-connection.service';
import { CentralStorageAccessService } from './central-storage-access.service';
import { CentralStorageAdminService, type AdminUsage, type AdminUserUsage } from './central-storage-admin.service';
import {
  abortWhenClientLeaves,
  parseWith,
  requestMeta,
  sendDownload,
  sendPreview,
  toIncoming,
  UPLOAD_OPTIONS,
} from './central-storage.http';
import { CentralStorageService } from './central-storage.service';
import {
  adminListQuerySchema,
  AdminUsageDto,
  AdminUserUsageDto,
  CentralConnectionStatusDto,
  CentralFileDto,
  CentralFilePageDto,
  ConnectUrlDto,
  RenameCentralFileDto,
  renameFileSchema,
  userSearchSchema,
} from './dto/central-storage.dto';
import { SystemAdminGuard } from './guards/system-admin.guard';
import { UploadAdmissionGuard, UploadOperationType } from './guards/upload-admission.guard';
import type { CentralFilePage, CentralFileView } from './types/central-storage.types';

const UPLOAD_BODY = {
  schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } },
};

const BIGINT_MAX = 9223372036854775807n;
function parseUserId(raw: string): bigint {
  if (!/^\d{1,19}$/.test(raw) || BigInt(raw) > BIGINT_MAX) {
    throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
  }
  return BigInt(raw);
}

/**
 * System administrators only (SystemAdminGuard checks core.system_admins in PostgreSQL on every request, and the
 * services check again before every write). Every action on another user's file is written to the audit trail first.
 */
@ApiTags('admin-central-storage')
@ApiCookieAuth(SESSION_SECURITY_SCHEME)
@Controller('admin/central-storage')
@UseGuards(SystemAdminGuard)
export class CentralStorageAdminController {
  constructor(
    private readonly files: CentralStorageService,
    private readonly admin: CentralStorageAdminService,
    private readonly access: CentralStorageAccessService,
    private readonly connection: CentralConnectionService,
  ) {}

  private actor(user: SessionUser, req: Request) {
    return this.access.adminActor(user, requestMeta(req));
  }

  // ----- files -----------------------------------------------------------------------------------------------------

  @ApiOperation({ summary: "List every user's files (search, type, owner filter, sort, pagination)" })
  @ApiResponse({ status: 200, type: CentralFilePageDto })
  @Get('files')
  async list(@CurrentUser() user: SessionUser, @Req() req: Request, @Query() query: unknown): Promise<CentralFilePage> {
    return this.files.list(await this.actor(user, req), parseWith(adminListQuerySchema, query));
  }

  @ApiOperation({ summary: 'Metadata of any file' })
  @ApiResponse({ status: 200, type: CentralFileDto })
  @Get('files/:id')
  async get(@CurrentUser() user: SessionUser, @Req() req: Request, @Param('id') id: string): Promise<CentralFileView> {
    return this.files.get(await this.actor(user, req), id);
  }

  @ApiOperation({ summary: 'Upload a file for a selected user (max 50 MB)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(UPLOAD_BODY)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 201, type: CentralFileDto })
  @Post('users/:userId/files/upload')
  @UploadOperationType('admin_upload')
  @UseGuards(UploadAdmissionGuard)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async uploadForUser(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Param('userId') userId: string,
    @Res({ passthrough: true }) res: Response,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<CentralFileView> {
    const incoming = toIncoming(file);
    try {
      return await this.files.upload(
        await this.actor(user, req),
        parseUserId(userId),
        incoming,
        abortWhenClientLeaves(res),
      );
    } finally {
      await rm(incoming.path, { force: true });
    }
  }

  @ApiOperation({ summary: 'Download any file' })
  @Get('files/:id/download')
  async download(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendDownload(res, await this.files.download(await this.actor(user, req), id));
  }

  @ApiOperation({ summary: 'Preview any file inline (images, PDF, plain text only)' })
  @Get('files/:id/preview')
  async preview(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendPreview(res, await this.files.preview(await this.actor(user, req), id));
  }

  @ApiOperation({ summary: 'Rename any file (display name; the extension must stay the same)' })
  @ApiBody({ type: RenameCentralFileDto })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 200, type: CentralFileDto })
  @Patch('files/:id')
  async rename(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<CentralFileView> {
    return this.files.rename(await this.actor(user, req), id, parseWith(renameFileSchema, body).name);
  }

  @ApiOperation({ summary: 'Replace the content of any file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(UPLOAD_BODY)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 200, type: CentralFileDto })
  @Put('files/:id/content')
  @UploadOperationType('admin_upload')
  @UseGuards(UploadAdmissionGuard)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async replace(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<CentralFileView> {
    const incoming = toIncoming(file);
    try {
      return await this.files.replace(await this.actor(user, req), id, incoming, abortWhenClientLeaves(res));
    } finally {
      await rm(incoming.path, { force: true });
    }
  }

  @ApiOperation({ summary: 'Delete any file (also retries an interrupted delete)' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 204 })
  @Delete('files/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: SessionUser, @Req() req: Request, @Param('id') id: string): Promise<void> {
    await this.files.remove(await this.actor(user, req), id);
  }

  @ApiOperation({
    summary: 'Resync a file with OneDrive',
    description: 'Repairs a file whose replacement was stored in OneDrive but not recorded (status "replacing").',
  })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 200, type: CentralFileDto })
  @Post('files/:id/resync')
  @HttpCode(200)
  async resync(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<CentralFileView> {
    return this.files.resync(await this.actor(user, req), id);
  }

  // ----- users and usage -------------------------------------------------------------------------------------------

  @ApiOperation({ summary: 'Users (upload targets / filter) with their storage usage' })
  @ApiResponse({ status: 200, type: [AdminUserUsageDto] })
  @Get('users')
  async users(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Query() query: unknown,
  ): Promise<AdminUserUsage[]> {
    return this.admin.listUsers(await this.actor(user, req), parseWith(userSearchSchema, query).search);
  }

  @ApiOperation({ summary: "One user's files" })
  @ApiResponse({ status: 200, type: CentralFilePageDto })
  @Get('users/:userId/files')
  async userFiles(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Param('userId') userId: string,
    @Query() query: unknown,
  ): Promise<CentralFilePage> {
    const parsed = parseWith(adminListQuerySchema, query);
    return this.files.list(await this.actor(user, req), { ...parsed, ownerUserId: parseUserId(userId).toString() });
  }

  @ApiOperation({ summary: 'Total and per-user storage usage' })
  @ApiResponse({ status: 200, type: AdminUsageDto })
  @Get('usage')
  async usage(@CurrentUser() user: SessionUser, @Req() req: Request): Promise<AdminUsage> {
    return this.admin.usage(await this.actor(user, req));
  }

  // ----- the central OneDrive connection ---------------------------------------------------------------------------

  @ApiOperation({ summary: 'Central OneDrive connection status (never any token)' })
  @ApiResponse({ status: 200, type: CentralConnectionStatusDto })
  @Get('connection')
  async connectionStatus(): Promise<CentralConnectionStatus> {
    return this.connection.getStatus();
  }

  @ApiOperation({
    summary: 'Start connecting (or reconnecting) the central OneDrive',
    description: 'Returns the Microsoft URL for consent to Files.ReadWrite. The browser must navigate to it.',
  })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 200, type: ConnectUrlDto })
  @Post('connection/connect')
  @HttpCode(200)
  async connect(@CurrentUser() user: SessionUser, @Req() req: Request): Promise<{ url: string }> {
    return { url: await this.connection.startConnect(await this.actor(user, req), user, req.session) };
  }

  @ApiOperation({ summary: 'Check the central OneDrive connection now (health, quota)' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 200, type: CentralConnectionStatusDto })
  @Post('connection/verify')
  @HttpCode(200)
  async verify(@CurrentUser() user: SessionUser, @Req() req: Request): Promise<CentralConnectionStatus> {
    return this.connection.verify(await this.actor(user, req));
  }
}
