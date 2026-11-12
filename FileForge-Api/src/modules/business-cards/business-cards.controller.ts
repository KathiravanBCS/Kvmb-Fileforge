import { rm } from 'node:fs/promises';

import type { Request, Response } from 'express';

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { SESSION_SECURITY_SCHEME } from '../../app.swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { SessionUser } from '../../common/types/session.types';
import { CentralStorageAccessService } from '../central-storage/central-storage-access.service';
import {
  abortWhenClientLeaves,
  parseWith,
  requestMeta,
  sendPreview,
  toIncoming,
  UPLOAD_OPTIONS,
} from '../central-storage/central-storage.http';
import { UploadAdmissionGuard, UploadOperationType } from '../central-storage/guards/upload-admission.guard';
import { CONTACT_READ_ROLES, CONTACT_WRITE_ROLES } from '../contacts/contacts.constants';
import { WorkspaceContext, WorkspaceRoles } from '../workspaces/workspace-access';
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard';
import type { WorkspaceMembership } from '../workspaces/workspaces.service';
import { businessCardPatchSchema } from './business-card.data';
import {
  BusinessCardsService,
  type BusinessCardPage,
  type BusinessCardView,
  type ScanContext,
} from './business-cards.service';
import {
  BusinessCardDto,
  BusinessCardPageDto,
  BusinessCardPatchDto,
  imageQuerySchema,
  scanListQuerySchema,
} from './dto/business-cards.dto';

/** A phone photo of a card. Larger than this is refused while it is being received. */
export const MAX_CARD_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_NAME = /\.(jpe?g|png|webp)$/i;

/** The central-storage upload handling (temporary file on disk, random name), narrowed to one small image. */
const SCAN_UPLOAD_OPTIONS: MulterOptions = {
  ...UPLOAD_OPTIONS,
  // Two photos at most: the front and the back of ONE card.
  limits: { ...UPLOAD_OPTIONS.limits, fileSize: MAX_CARD_IMAGE_BYTES, files: 2 },
  fileFilter: (_req, file, done) =>
    IMAGE_NAME.test(file.originalname)
      ? done(null, true)
      : done(
          new BadRequestException({
            code: 'IMAGE_TYPE_NOT_SUPPORTED',
            message: 'Use a JPG, PNG or WebP photo of the card.',
          }),
          false,
        ),
};

const SCAN_BODY = {
  schema: {
    type: 'object',
    required: ['front'],
    properties: { front: { type: 'string', format: 'binary' }, back: { type: 'string', format: 'binary' } },
  },
};

/**
 * Business cards of a workspace. Every route is authenticated (global guard), CSRF-checked when it changes state (global guard)
 * and needs membership of the workspace in the URL. A user only ever sees their own scans.
 */
@ApiTags('business-cards')
@ApiCookieAuth(SESSION_SECURITY_SCHEME)
@Controller('workspaces/:workspaceId/business-cards')
@UseGuards(WorkspaceAccessGuard)
export class BusinessCardsController {
  constructor(
    private readonly cards: BusinessCardsService,
    private readonly access: CentralStorageAccessService,
  ) {}

  private async context(
    req: Request,
    user: SessionUser,
    workspace: WorkspaceMembership | undefined,
  ): Promise<ScanContext> {
    // WorkspaceAccessGuard always sets this; the check keeps a missing guard from becoming an open route.
    if (!workspace) throw new BadRequestException({ code: 'WORKSPACE_REQUIRED', message: 'A workspace is required.' });
    return { workspaceId: workspace.workspaceId, user, actor: await this.access.userActor(user, requestMeta(req)) };
  }

  @ApiOperation({
    summary: 'Scan a business card',
    description:
      'multipart/form-data with a `file` part (JPG, PNG or WebP, up to 10 MB). Reads the card, stores the photo in central ' +
      'storage and returns a PENDING scan to review. Nothing becomes a contact until it is approved.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody(SCAN_BODY)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 201, type: BusinessCardDto })
  @WorkspaceRoles(...CONTACT_WRITE_ROLES)
  @Post('scan')
  @UploadOperationType('upload')
  @UseGuards(UploadAdmissionGuard)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'front', maxCount: 1 },
        { name: 'back', maxCount: 1 },
      ],
      SCAN_UPLOAD_OPTIONS,
    ),
  )
  async scan(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @UploadedFiles() files?: { front?: Express.Multer.File[]; back?: Express.Multer.File[] },
    @WorkspaceContext() workspace?: WorkspaceMembership,
  ): Promise<BusinessCardView> {
    const received = [files?.front?.[0], files?.back?.[0]].filter(
      (file): file is Express.Multer.File => file !== undefined,
    );
    try {
      // The front is required; toIncoming answers 400 FILE_REQUIRED when it is missing.
      const front = toIncoming(files?.front?.[0]);
      const back = files?.back?.[0] ? toIncoming(files.back[0]) : undefined;
      return await this.cards.scan(
        await this.context(req, user, workspace),
        { front, back },
        abortWhenClientLeaves(res),
      );
    } finally {
      await Promise.all(received.map((file) => rm(file.path, { force: true })));
    }
  }

  @ApiOperation({ summary: 'My scanned cards, newest first (optionally only pending / approved / rejected)' })
  @ApiResponse({ status: 200, type: BusinessCardPageDto })
  @WorkspaceRoles(...CONTACT_READ_ROLES)
  @Get()
  async list(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Query() query: unknown,
    @WorkspaceContext() workspace?: WorkspaceMembership,
  ): Promise<BusinessCardPage> {
    return this.cards.list(await this.context(req, user, workspace), parseWith(scanListQuerySchema, query));
  }

  @ApiOperation({ summary: 'One scanned card' })
  @ApiResponse({ status: 200, type: BusinessCardDto })
  @WorkspaceRoles(...CONTACT_READ_ROLES)
  @Get(':id')
  async get(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Param('id') id: string,
    @WorkspaceContext() workspace?: WorkspaceMembership,
  ): Promise<BusinessCardView> {
    return this.cards.get(await this.context(req, user, workspace), id);
  }

  @ApiOperation({ summary: 'The photo of a scanned card', description: 'Shown inline; read from central storage.' })
  @WorkspaceRoles(...CONTACT_READ_ROLES)
  @Get(':id/image')
  async image(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Query() query: unknown,
    @WorkspaceContext() workspace?: WorkspaceMembership,
  ): Promise<StreamableFile> {
    const { side } = parseWith(imageQuerySchema, query);
    return sendPreview(res, await this.cards.image(await this.context(req, user, workspace), id, side));
  }

  @ApiOperation({
    summary: 'Correct what was read from a pending card',
    description:
      'Only the fields that are sent change (also inside address and socialLinks). null or "" clears a field.',
  })
  @ApiBody({ type: BusinessCardPatchDto })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 200, type: BusinessCardDto })
  @WorkspaceRoles(...CONTACT_WRITE_ROLES)
  @Patch(':id')
  async update(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
    @WorkspaceContext() workspace?: WorkspaceMembership,
  ): Promise<BusinessCardView> {
    return this.cards.update(await this.context(req, user, workspace), id, parseWith(businessCardPatchSchema, body));
  }

  @ApiOperation({
    summary: 'Approve a card: save it as a contact',
    description:
      'Creates the contact (or adds the card to the contact that already has the same e-mail) and links it to this card: ' +
      'entity type business_card_scan, entity id = this card.',
  })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 201, type: BusinessCardDto })
  @WorkspaceRoles(...CONTACT_WRITE_ROLES)
  @Post(':id/approve')
  async approve(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Param('id') id: string,
    @WorkspaceContext() workspace?: WorkspaceMembership,
  ): Promise<BusinessCardView> {
    return this.cards.approve(await this.context(req, user, workspace), id);
  }

  @ApiOperation({ summary: 'Reject a card: no contact is created' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 201, type: BusinessCardDto })
  @WorkspaceRoles(...CONTACT_WRITE_ROLES)
  @Post(':id/reject')
  async reject(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Param('id') id: string,
    @WorkspaceContext() workspace?: WorkspaceMembership,
  ): Promise<BusinessCardView> {
    return this.cards.reject(await this.context(req, user, workspace), id);
  }
}
