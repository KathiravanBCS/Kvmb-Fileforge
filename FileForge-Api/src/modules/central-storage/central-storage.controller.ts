import { rm } from 'node:fs/promises';

import type { Request, Response } from 'express';

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { CentralConnectionService } from './central-connection.service';
import { CentralStorageAccessService } from './central-storage-access.service';
import { CENTRAL_MAX_FILE_BYTES } from './central-storage.constants';
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
  CentralCapabilitiesDto,
  CentralFileDto,
  CentralFilePageDto,
  CentralUsageDto,
  listQuerySchema,
  RenameCentralFileDto,
  renameFileSchema,
} from './dto/central-storage.dto';
import { UploadAdmissionGuard, UploadOperationType } from './guards/upload-admission.guard';
import type { CentralFilePage, CentralFileView, CentralUsage } from './types/central-storage.types';

const UPLOAD_BODY = {
  schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } },
};

/**
 * "My Files": every route acts as the signed-in user ONLY and shows only that user's files, even for an administrator
 * (administrators use /admin/central-storage). Ownership always comes from the server session, never from the request.
 */
@ApiTags('central-storage')
@ApiCookieAuth(SESSION_SECURITY_SCHEME)
@Controller('central-storage')
export class CentralStorageController {
  constructor(
    private readonly files: CentralStorageService,
    private readonly access: CentralStorageAccessService,
    private readonly connection: CentralConnectionService,
  ) {}

  private actor(user: SessionUser, req: Request) {
    return this.access.userActor(user, requestMeta(req));
  }

  @ApiOperation({ summary: 'What the signed-in user can do with central storage' })
  @ApiResponse({ status: 200, type: CentralCapabilitiesDto })
  @Get('capabilities')
  async capabilities(@CurrentUser() user: SessionUser): Promise<CentralCapabilitiesDto> {
    const [isSystemAdmin, status] = await Promise.all([
      this.access.isSystemAdmin(BigInt(user.id)),
      this.connection.getStatus(),
    ]);
    return { isSystemAdmin, available: status.usable, maxFileBytes: CENTRAL_MAX_FILE_BYTES };
  }

  @ApiOperation({ summary: 'List my files (search, type filter, sort, pagination)' })
  @ApiResponse({ status: 200, type: CentralFilePageDto })
  @Get('files')
  async list(@CurrentUser() user: SessionUser, @Req() req: Request, @Query() query: unknown): Promise<CentralFilePage> {
    return this.files.list(await this.actor(user, req), parseWith(listQuerySchema, query));
  }

  @ApiOperation({ summary: 'My storage usage' })
  @ApiResponse({ status: 200, type: CentralUsageDto })
  @Get('usage')
  async usage(@CurrentUser() user: SessionUser, @Req() req: Request): Promise<CentralUsage> {
    return this.files.usage(await this.actor(user, req));
  }

  @ApiOperation({ summary: 'Upload a file (max 50 MB)', description: 'multipart/form-data with a `file` part.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(UPLOAD_BODY)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 201, type: CentralFileDto })
  @Post('files/upload')
  @UploadOperationType('upload')
  @UseGuards(UploadAdmissionGuard)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async upload(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<CentralFileView> {
    const incoming = toIncoming(file);
    try {
      return await this.files.upload(await this.actor(user, req), null, incoming, abortWhenClientLeaves(res));
    } finally {
      await rm(incoming.path, { force: true });
    }
  }

  @ApiOperation({ summary: 'Metadata of one of my files' })
  @ApiResponse({ status: 200, type: CentralFileDto })
  @Get('files/:id')
  async get(@CurrentUser() user: SessionUser, @Req() req: Request, @Param('id') id: string): Promise<CentralFileView> {
    return this.files.get(await this.actor(user, req), id);
  }

  @ApiOperation({ summary: 'Download one of my files', description: 'Streamed through the API as an attachment.' })
  @Get('files/:id/download')
  async download(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendDownload(res, await this.files.download(await this.actor(user, req), id));
  }

  @ApiOperation({ summary: 'Preview one of my files inline (images, PDF, plain text only)' })
  @ApiResponse({ status: 415, description: 'PREVIEW_NOT_SUPPORTED: download it instead.' })
  @Get('files/:id/preview')
  async preview(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendPreview(res, await this.files.preview(await this.actor(user, req), id));
  }

  @ApiOperation({ summary: 'Rename one of my files (display name; the extension must stay the same)' })
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

  @ApiOperation({
    summary: 'Replace the content of one of my files',
    description: 'multipart/form-data with a `file` part.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody(UPLOAD_BODY)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 200, type: CentralFileDto })
  @Put('files/:id/content')
  @UploadOperationType('replace')
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

  @ApiOperation({ summary: 'Delete one of my files (OneDrive recycle bin)' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 204 })
  @Delete('files/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: SessionUser, @Req() req: Request, @Param('id') id: string): Promise<void> {
    await this.files.remove(await this.actor(user, req), id);
  }
}
