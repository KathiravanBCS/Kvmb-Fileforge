import type { Request, Response } from 'express';

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { SESSION_SECURITY_SCHEME } from '../../../app.swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { SessionUser } from '../../../common/types/session.types';
import { WorkspaceContext, WorkspaceRoles } from '../../workspaces/workspace-access';
import { WorkspaceAccessGuard } from '../../workspaces/workspace-access.guard';
import type { WorkspaceMembership } from '../../workspaces/workspaces.service';
import {
  ConnectUrlDto,
  OneDriveItemDto,
  OneDriveListingDto,
  OneDriveStatusDto,
  RenameFileDto,
  renameFileSchema,
} from './dto/onedrive.dto';
import { OneDriveConnectionService } from './onedrive-connection.service';
import { OneDriveFilesService, type StorageRequestContext } from './onedrive-files.service';
import { attachmentDisposition } from './onedrive-paths';
import { MANAGE_ROLES, MAX_UPLOAD_BYTES, READ_ROLES, WRITE_ROLES } from './onedrive.constants';
import type { OneDriveItem, OneDriveListing, OneDriveStatus } from './onedrive.types';

// Memory storage with a hard size cap: an oversized upload is rejected (413) while it is being received.
// `defParamCharset` makes multer read non-ASCII file names as UTF-8 instead of latin1.
const UPLOAD_OPTIONS = {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4, fieldSize: 1024 },
  defParamCharset: 'utf8',
} as MulterOptions;

/**
 * OneDrive for a workspace. Every route is authenticated (global guard), CSRF-checked when it changes state (global
 * guard), requires membership of the workspace in the URL, and a role that may perform the operation.
 */
@ApiTags('storage')
@ApiCookieAuth(SESSION_SECURITY_SCHEME)
@Controller('workspaces/:workspaceId/storage/onedrive')
@UseGuards(WorkspaceAccessGuard)
export class OneDriveController {
  constructor(
    private readonly connections: OneDriveConnectionService,
    private readonly files: OneDriveFilesService,
  ) {}

  private context(req: Request, user: SessionUser, workspace: WorkspaceMembership | undefined): StorageRequestContext {
    // WorkspaceAccessGuard always sets this; the check keeps a missing guard from becoming an open route.
    if (!workspace) throw new BadRequestException({ code: 'WORKSPACE_REQUIRED', message: 'A workspace is required.' });
    return { workspaceId: workspace.workspaceId, user, session: req.session };
  }

  @ApiOperation({ summary: 'OneDrive connection status for this workspace' })
  @ApiResponse({ status: 200, type: OneDriveStatusDto })
  @WorkspaceRoles(...READ_ROLES)
  @Get()
  status(
    @Req() req: Request,
    @CurrentUser() user: SessionUser,
    @WorkspaceContext() workspace?: WorkspaceMembership,
  ): Promise<OneDriveStatus> {
    const ctx = this.context(req, user, workspace);
    return this.connections.getStatus(ctx.workspaceId, user, req.session);
  }

  @ApiOperation({
    summary: 'Start Connect OneDrive',
    description:
      'Returns the Microsoft URL for incremental consent to Files.ReadWrite. The browser must navigate to it.',
  })
  @ApiResponse({ status: 200, type: ConnectUrlDto })
  @WorkspaceRoles(...MANAGE_ROLES)
  @Post('connect')
  @HttpCode(200)
  async connect(
    @Req() req: Request,
    @CurrentUser() user: SessionUser,
    @WorkspaceContext() workspace?: WorkspaceMembership,
  ): Promise<{ url: string }> {
    const ctx = this.context(req, user, workspace);
    return { url: await this.connections.startConnect(ctx.workspaceId, user, req.session) };
  }

  @ApiOperation({ summary: 'List a folder (relative to the FileForge folder)' })
  @ApiQuery({ name: 'path', required: false, description: 'Folder path; empty is the FileForge root.' })
  @ApiResponse({ status: 200, type: OneDriveListingDto })
  @WorkspaceRoles(...READ_ROLES)
  @Get('items')
  list(
    @Req() req: Request,
    @CurrentUser() user: SessionUser,
    @Query('path') path: unknown,
    @WorkspaceContext() workspace?: WorkspaceMembership,
  ): Promise<OneDriveListing> {
    return this.files.list(this.context(req, user, workspace), path);
  }

  @ApiOperation({
    summary: 'Upload a small file',
    description: 'multipart/form-data with a `file` part and an optional `path` field (target folder). Max 4 MB.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' }, path: { type: 'string', example: 'invoices' } },
    },
  })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 201, type: OneDriveItemDto })
  @WorkspaceRoles(...WRITE_ROLES)
  @Post('files')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  upload(
    @Req() req: Request,
    @CurrentUser() user: SessionUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('path') path: unknown,
    @WorkspaceContext() workspace?: WorkspaceMembership,
  ): Promise<OneDriveItem> {
    return this.files.upload(
      this.context(req, user, workspace),
      path,
      file && { name: file.originalname, buffer: file.buffer },
    );
  }

  @ApiOperation({
    summary: 'Download a file',
    description: 'Streamed through the API as an attachment. Never rendered inline.',
  })
  @ApiQuery({ name: 'path', required: true })
  @ApiResponse({ status: 200, description: 'The file bytes (application/octet-stream, attachment).' })
  @WorkspaceRoles(...READ_ROLES)
  @Get('files/content')
  async download(
    @Req() req: Request,
    @CurrentUser() user: SessionUser,
    @Query('path') path: unknown,
    @Res({ passthrough: true }) res: Response,
    @WorkspaceContext() workspace?: WorkspaceMembership,
  ): Promise<StreamableFile> {
    const file = await this.files.download(this.context(req, user, workspace), path);
    res.set({
      // Always a download, whatever the file claims to be: a stored HTML/SVG file must never run on this origin.
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': attachmentDisposition(file.filename),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(file.stream);
  }

  @ApiOperation({ summary: 'Rename a file (same folder)' })
  @ApiBody({ type: RenameFileDto })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 200, type: OneDriveItemDto })
  @WorkspaceRoles(...WRITE_ROLES)
  @Patch('files')
  rename(
    @Req() req: Request,
    @CurrentUser() user: SessionUser,
    @Body() body: unknown,
    @WorkspaceContext() workspace?: WorkspaceMembership,
  ): Promise<OneDriveItem> {
    const parsed = renameFileSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: 'INVALID_REQUEST', message: 'Send { path, newName }.' });
    return this.files.rename(this.context(req, user, workspace), parsed.data.path, parsed.data.newName);
  }

  @ApiOperation({ summary: 'Delete a file (moves it to the OneDrive recycle bin)' })
  @ApiQuery({ name: 'path', required: true })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 204 })
  @WorkspaceRoles(...MANAGE_ROLES)
  @Delete('files')
  @HttpCode(204)
  async remove(
    @Req() req: Request,
    @CurrentUser() user: SessionUser,
    @Query('path') path: unknown,
    @WorkspaceContext() workspace?: WorkspaceMembership,
  ): Promise<void> {
    await this.files.delete(this.context(req, user, workspace), path);
  }
}
