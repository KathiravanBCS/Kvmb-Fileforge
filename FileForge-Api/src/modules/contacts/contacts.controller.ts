import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { SESSION_SECURITY_SCHEME } from '../../app.swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { SessionUser } from '../../common/types/session.types';
import { parseWith } from '../central-storage/central-storage.http';
import { WorkspaceContext, WorkspaceRoles } from '../workspaces/workspace-access';
import { WorkspaceAccessGuard } from '../workspaces/workspace-access.guard';
import type { WorkspaceMembership } from '../workspaces/workspaces.service';
import { CONTACT_READ_ROLES, CONTACT_WRITE_ROLES } from './contacts.constants';
import { ContactsService } from './contacts.service';
import type { ContactPage, ContactView } from './contacts.types';
import {
  ContactDto,
  contactListQuerySchema,
  ContactPageDto,
  UpdateContactDto,
  updateContactSchema,
} from './dto/contacts.dto';

/**
 * The centralized contacts of a workspace: the contacts of every module in one place. Every route is authenticated (global
 * guard), CSRF-checked when it changes state (global guard) and needs membership of the workspace in the URL.
 */
@ApiTags('contacts')
@ApiCookieAuth(SESSION_SECURITY_SCHEME)
@Controller('workspaces/:workspaceId/contacts')
@UseGuards(WorkspaceAccessGuard)
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  private workspaceId(workspace: WorkspaceMembership | undefined): string {
    // WorkspaceAccessGuard always sets this; the check keeps a missing guard from becoming an open route.
    if (!workspace) throw new BadRequestException({ code: 'WORKSPACE_REQUIRED', message: 'A workspace is required.' });
    return workspace.workspaceId;
  }

  @ApiOperation({ summary: 'List contacts (search, review status, pagination), newest first' })
  @ApiResponse({ status: 200, type: ContactPageDto })
  @WorkspaceRoles(...CONTACT_READ_ROLES)
  @Get()
  list(@Query() query: unknown, @WorkspaceContext() workspace?: WorkspaceMembership): Promise<ContactPage> {
    return this.contacts.list(this.workspaceId(workspace), parseWith(contactListQuerySchema, query));
  }

  @ApiOperation({ summary: 'One contact with its methods, addresses and the records it is linked to' })
  @ApiResponse({ status: 200, type: ContactDto })
  @WorkspaceRoles(...CONTACT_READ_ROLES)
  @Get(':id')
  get(@Param('id') id: string, @WorkspaceContext() workspace?: WorkspaceMembership): Promise<ContactView> {
    return this.contacts.get(this.workspaceId(workspace), id);
  }

  @ApiOperation({ summary: 'Change a contact', description: 'Only the fields that are sent change.' })
  @ApiBody({ type: UpdateContactDto })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 200, type: ContactDto })
  @WorkspaceRoles(...CONTACT_WRITE_ROLES)
  @Patch(':id')
  update(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @WorkspaceContext() workspace?: WorkspaceMembership,
  ): Promise<ContactView> {
    return this.contacts.update(this.workspaceId(workspace), id, user.id, parseWith(updateContactSchema, body));
  }

  @ApiOperation({ summary: 'Delete a contact', description: 'Soft delete. The records it came from are not touched.' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 204 })
  @WorkspaceRoles(...CONTACT_WRITE_ROLES)
  @HttpCode(204)
  @Delete(':id')
  async remove(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @WorkspaceContext() workspace?: WorkspaceMembership,
  ): Promise<void> {
    await this.contacts.remove(this.workspaceId(workspace), id, user.id);
  }
}
