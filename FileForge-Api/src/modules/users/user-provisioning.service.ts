import { Injectable, Logger } from '@nestjs/common';

import { MICROSOFT_PROVIDER, OWNER_ROLE_CODE } from '../../common/constants/auth.constants';
import { AuthFlowError } from '../../common/exceptions/auth-flow.error';
import { PrismaService } from '../../prisma/prisma.service';
import type { VerifiedMicrosoftIdentity } from '../microsoft/identity/microsoft-identity.types';

/** `id` is a BIGINT and stays a bigint here; it is turned into a decimal string at the API boundary. */
export interface ProvisionedUser {
  id: bigint;
  email: string;
  displayName: string | null;
}

const MAX_WORKSPACE_NAME_LENGTH = 200;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

/**
 * Maps a verified Microsoft identity to a FileForge user, creating the user on first sign-in.
 *
 * Accounts are matched ONLY by (provider, issuer, subject) in core.user_identities. Email is never used to
 * find or merge accounts: a personal and an organizational Microsoft account with the same address are
 * different identities. core.users has a unique index on lower(email), so the second one cannot get its own
 * user row; that case is refused (`email_in_use`) instead of merged. Linking needs an explicit, verified flow.
 */
@Injectable()
export class UserProvisioningService {
  private readonly logger = new Logger(UserProvisioningService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolveOrProvision(identity: VerifiedMicrosoftIdentity): Promise<ProvisionedUser> {
    const existing = await this.findByIdentity(identity);
    if (existing) return this.recordLogin(existing);

    try {
      return await this.provisionNew(identity);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // A concurrent first sign-in of the same identity may have won the race: that is not an error.
      const raced = await this.findByIdentity(identity);
      if (raced) return this.recordLogin(raced);
      throw new AuthFlowError('account_unavailable', 'unique_conflict', { cause: error });
    }
  }

  private async findByIdentity(identity: VerifiedMicrosoftIdentity) {
    const row = await this.prisma.user_identities.findUnique({
      where: {
        provider_issuer_subject: {
          provider: identity.provider,
          issuer: identity.issuer,
          subject: identity.subject,
        },
      },
    });
    if (!row) return null;
    if (row.is_deleted) throw new AuthFlowError('account_unavailable', 'identity_disabled');

    const user = await this.prisma.users.findUnique({ where: { id: row.user_id } });
    if (!user || user.is_deleted || !user.is_active) throw new AuthFlowError('account_unavailable', 'account_disabled');
    return user;
  }

  private async recordLogin(user: { id: bigint; email: string; display_name: string | null }) {
    await this.prisma.users.update({ where: { id: user.id }, data: { last_login_at: new Date() } });
    return { id: user.id, email: user.email, displayName: user.display_name };
  }

  /** User + identity + personal workspace + owner membership: all or nothing. */
  private async provisionNew(identity: VerifiedMicrosoftIdentity): Promise<ProvisionedUser> {
    const email = identity.email;
    if (!email) throw new AuthFlowError('account_unavailable', 'email_unavailable');

    return this.prisma.$transaction(async (tx) => {
      // Never assumed to be seeded: look it up, and refuse to create an owner-less workspace.
      const ownerRole = await tx.roles.findFirst({ where: { code: OWNER_ROLE_CODE, is_deleted: false } });
      if (!ownerRole) throw new AuthFlowError('account_unavailable', 'owner_role_missing');

      // Pre-check only to give a clear refusal. The unique index on lower(email) is the real guarantee.
      const emailTaken = await tx.users.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, is_deleted: false },
        select: { id: true },
      });
      if (emailTaken) throw new AuthFlowError('account_unavailable', 'email_in_use');

      const user = await tx.users.create({
        data: {
          auth_provider: MICROSOFT_PROVIDER,
          email,
          display_name: identity.displayName,
          last_login_at: new Date(),
        },
      });

      await tx.user_identities.create({
        data: {
          user_id: user.id,
          provider: identity.provider,
          account_type: identity.accountType,
          issuer: identity.issuer,
          subject: identity.subject,
          tenant_id: identity.tenantId,
          home_account_id: identity.homeAccountId,
          provider_user_id: identity.providerUserId,
          login_hint: identity.loginHint,
          is_primary: true,
        },
      });

      const workspace = await tx.workspaces.create({
        data: {
          name: `${identity.displayName ?? email}'s workspace`.slice(0, MAX_WORKSPACE_NAME_LENGTH),
          slug: `personal-${user.id}`,
          workspace_type: 'personal',
          owner_user_id: user.id,
        },
      });

      await tx.workspace_members.create({
        data: { workspace_id: workspace.id, user_id: user.id, role_id: ownerRole.id },
      });

      this.logger.log({ event: 'user_provisioned', accountType: identity.accountType });
      return { id: user.id, email: user.email, displayName: user.display_name };
    });
  }
}
