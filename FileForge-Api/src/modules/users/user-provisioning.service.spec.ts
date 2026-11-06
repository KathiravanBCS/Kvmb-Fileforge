import { Logger } from '@nestjs/common';

import { AuthFlowError } from '../../common/exceptions/auth-flow.error';
import type { PrismaService } from '../../prisma/prisma.service';
import type { VerifiedMicrosoftIdentity } from '../microsoft/identity/microsoft-identity.types';
import { UserProvisioningService } from './user-provisioning.service';

const ORG_TENANT = '11111111-2222-3333-4444-555555555555';
const PERSONAL_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

function identity(overrides: Partial<VerifiedMicrosoftIdentity> = {}): VerifiedMicrosoftIdentity {
  return {
    provider: 'microsoft',
    issuer: `https://login.microsoftonline.com/${ORG_TENANT}/v2.0`,
    subject: 'oid-org',
    providerUserId: 'sub-org',
    tenantId: ORG_TENANT,
    accountType: 'organizational',
    homeAccountId: 'home-org',
    email: 'same.person@example.com',
    displayName: 'Same Person',
    loginHint: 'same.person@example.com',
    ...overrides,
  };
}

const personalIdentity = () =>
  identity({
    issuer: `https://login.microsoftonline.com/${PERSONAL_TENANT}/v2.0`,
    subject: 'oid-personal',
    providerUserId: 'sub-personal',
    tenantId: PERSONAL_TENANT,
    accountType: 'personal',
  });

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7n,
    email: 'same.person@example.com',
    display_name: 'Same Person',
    is_active: true,
    is_deleted: false,
    ...overrides,
  };
}

/** A fake Prisma client: top-level has reads only, so any write outside $transaction would throw. */
function createPrisma() {
  const tx = {
    roles: { findFirst: jest.fn().mockResolvedValue({ id: 1n, code: 'owner' }) },
    users: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(userRow({ id: 42n })),
    },
    user_identities: { create: jest.fn().mockResolvedValue({}) },
    workspaces: { create: jest.fn().mockResolvedValue({ id: 99n }) },
    workspace_members: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    user_identities: { findUnique: jest.fn().mockResolvedValue(null) },
    users: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  };
  return { prisma, tx, service: new UserProvisioningService(prisma as unknown as PrismaService) };
}

describe('UserProvisioningService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  describe('first sign-in', () => {
    it('creates user, identity, personal workspace and owner membership in ONE transaction', async () => {
      const { prisma, tx, service } = createPrisma();

      const user = await service.resolveOrProvision(identity());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.users.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          auth_provider: 'microsoft',
          email: 'same.person@example.com',
          display_name: 'Same Person',
        }),
      });
      expect(tx.user_identities.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          user_id: 42n,
          provider: 'microsoft',
          account_type: 'organizational',
          issuer: `https://login.microsoftonline.com/${ORG_TENANT}/v2.0`,
          subject: 'oid-org',
          tenant_id: ORG_TENANT,
          is_primary: true,
        }),
      });
      expect(tx.workspaces.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ slug: 'personal-42', workspace_type: 'personal', owner_user_id: 42n }),
      });
      expect(tx.workspace_members.create).toHaveBeenCalledWith({
        data: { workspace_id: 99n, user_id: 42n, role_id: 1n }, // role id comes from the DB lookup, not a constant
      });
      expect(user).toEqual({ id: 42n, email: 'same.person@example.com', displayName: 'Same Person' });
    });

    it('keeps a BIGINT id above 2^53 exact and allows a null display name', async () => {
      const { tx, service } = createPrisma();
      tx.users.create.mockResolvedValue(userRow({ id: 9007199254740993n, display_name: null }));

      const user = await service.resolveOrProvision(identity({ displayName: null }));

      expect(user.id).toBe(9007199254740993n);
      expect(user.displayName).toBeNull();
      expect(tx.users.create).toHaveBeenCalledWith({ data: expect.objectContaining({ display_name: null }) });
    });

    it('refuses to create an owner-less workspace when the owner role is not seeded', async () => {
      const { tx, service } = createPrisma();
      tx.roles.findFirst.mockResolvedValue(null);

      await expect(service.resolveOrProvision(identity())).rejects.toMatchObject({
        code: 'account_unavailable',
        reason: 'owner_role_missing',
      });
      expect(tx.users.create).not.toHaveBeenCalled();
      expect(tx.workspaces.create).not.toHaveBeenCalled();
    });

    it('needs an email address, because core.users.email is NOT NULL', async () => {
      const { prisma, service } = createPrisma();
      await expect(service.resolveOrProvision(identity({ email: null }))).rejects.toMatchObject({
        reason: 'email_unavailable',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not leave a partial account behind: a failure inside the transaction propagates', async () => {
      const { tx, service } = createPrisma();
      tx.workspaces.create.mockRejectedValue(new Error('connection lost'));
      await expect(service.resolveOrProvision(identity())).rejects.toThrow('connection lost');
      // The rollback itself is PostgreSQL's job (all writes ran on the transaction client).
      expect(tx.workspace_members.create).not.toHaveBeenCalled();
    });
  });

  describe('identity matching', () => {
    it('finds users by provider + issuer + subject only, never by email', async () => {
      const { prisma, tx, service } = createPrisma();
      prisma.user_identities.findUnique.mockResolvedValue({ user_id: 7n, is_deleted: false });
      prisma.users.findUnique.mockResolvedValue(userRow());

      const user = await service.resolveOrProvision(identity());

      expect(prisma.user_identities.findUnique).toHaveBeenCalledWith({
        where: {
          provider_issuer_subject: {
            provider: 'microsoft',
            issuer: `https://login.microsoftonline.com/${ORG_TENANT}/v2.0`,
            subject: 'oid-org',
          },
        },
      });
      expect(tx.users.findFirst).not.toHaveBeenCalled(); // no email lookup
      expect(prisma.$transaction).not.toHaveBeenCalled(); // nothing is created for a known identity
      expect(prisma.users.update).toHaveBeenCalledWith({
        where: { id: 7n },
        data: { last_login_at: expect.any(Date) },
      });
      expect(user).toEqual({ id: 7n, email: 'same.person@example.com', displayName: 'Same Person' });
    });

    it('does NOT merge a personal and an organizational account that share the same email', async () => {
      const { prisma, tx, service } = createPrisma();
      // The organizational account already exists; the personal account is a different (issuer, subject).
      tx.users.findFirst.mockResolvedValue({ id: 7n });

      await expect(service.resolveOrProvision(personalIdentity())).rejects.toMatchObject({
        name: 'AuthFlowError',
        code: 'account_unavailable',
        reason: 'email_in_use',
      });

      // It was looked up by its OWN issuer/subject, found nothing, and nothing was linked or created.
      expect(prisma.user_identities.findUnique).toHaveBeenCalledWith({
        where: { provider_issuer_subject: expect.objectContaining({ subject: 'oid-personal' }) },
      });
      expect(tx.users.create).not.toHaveBeenCalled();
      expect(tx.user_identities.create).not.toHaveBeenCalled();
    });

    it('treats a lost first-sign-in race as a normal sign-in of the winner', async () => {
      const { prisma, tx, service } = createPrisma();
      prisma.user_identities.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ user_id: 7n, is_deleted: false });
      prisma.users.findUnique.mockResolvedValue(userRow());
      tx.users.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

      await expect(service.resolveOrProvision(identity())).resolves.toMatchObject({ id: 7n });
    });

    it('reports a unique-constraint conflict that is not a race as unavailable, not as success', async () => {
      const { tx, service } = createPrisma();
      tx.users.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
      await expect(service.resolveOrProvision(identity())).rejects.toBeInstanceOf(AuthFlowError);
    });
  });

  describe('disabled accounts', () => {
    it.each([
      ['an inactive user', { is_active: false }],
      ['a soft-deleted user', { is_deleted: true }],
    ])('refuses %s', async (_label, overrides) => {
      const { prisma, service } = createPrisma();
      prisma.user_identities.findUnique.mockResolvedValue({ user_id: 7n, is_deleted: false });
      prisma.users.findUnique.mockResolvedValue(userRow(overrides));
      await expect(service.resolveOrProvision(identity())).rejects.toMatchObject({ reason: 'account_disabled' });
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('refuses a soft-deleted identity instead of re-creating it', async () => {
      const { prisma, service } = createPrisma();
      prisma.user_identities.findUnique.mockResolvedValue({ user_id: 7n, is_deleted: true });
      await expect(service.resolveOrProvision(identity())).rejects.toMatchObject({ reason: 'identity_disabled' });
    });
  });
});
