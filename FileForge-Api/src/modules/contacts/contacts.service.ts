import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ContactMethodInput,
  ContactPage,
  ContactPerson,
  ContactSummary,
  ContactView,
  SaveFromSourceInput,
} from './contacts.types';
import type { ContactListQuery, UpdateContactInput } from './dto/contacts.dto';

const BIGINT_MAX = 9223372036854775807n;
const LIVE = { is_deleted: false } as const;

const notFound = () => new NotFoundException({ code: 'CONTACT_NOT_FOUND', message: 'Contact not found.' });

function parseId(raw: string): bigint {
  if (!/^\d{1,19}$/.test(raw) || BigInt(raw) > BIGINT_MAX) throw notFound();
  return BigInt(raw);
}

/** Case-insensitive identity of a method, so "A@x.com" and "a@x.com" are the same e-mail. */
const methodKey = (type: string, value: string) => `${type}:${value.trim().toLowerCase()}`;

const contactInclude = {
  contact_source_types: { select: { code: true } },
  contact_methods: { where: LIVE, orderBy: [{ is_primary: 'desc' }, { id: 'asc' }] },
  contact_addresses: { where: LIVE, orderBy: { id: 'asc' } },
  contact_entity_links: { where: LIVE, orderBy: { id: 'asc' }, include: { entity_types: { select: { code: true } } } },
} satisfies Prisma.contactsInclude;
type ContactRow = Prisma.contactsGetPayload<{ include: typeof contactInclude }>;

const summaryInclude = {
  contact_methods: { where: LIVE, orderBy: [{ is_primary: 'desc' }, { id: 'asc' }] },
} satisfies Prisma.contactsInclude;
type SummaryRow = Prisma.contactsGetPayload<{ include: typeof summaryInclude }>;

/**
 * The centralized contacts of a workspace: ONE set of tables for the contacts of every module. A module hands a person over
 * with `saveFromSource` (which also links the contact to the record it came from); everything else here is the contacts
 * API itself. Every query is scoped to the workspace; a contact of another workspace is simply "not found".
 */
@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, query: ContactListQuery): Promise<ContactPage> {
    const where: Prisma.contactsWhereInput = {
      workspace_id: BigInt(workspaceId),
      ...LIVE,
      ...(query.reviewStatus ? { review_status: query.reviewStatus } : {}),
      ...(query.q
        ? {
            OR: [
              { display_name: { contains: query.q, mode: 'insensitive' } },
              { organization: { contains: query.q, mode: 'insensitive' } },
              { job_title: { contains: query.q, mode: 'insensitive' } },
              { contact_methods: { some: { ...LIVE, value: { contains: query.q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.contacts.findMany({
        where,
        include: summaryInclude,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.contacts.count({ where }),
    ]);
    return { items: rows.map(toSummary), page: query.page, pageSize: query.pageSize, total };
  }

  async get(workspaceId: string, rawId: string): Promise<ContactView> {
    const row = await this.prisma.contacts.findFirst({
      where: { id: parseId(rawId), workspace_id: BigInt(workspaceId), ...LIVE },
      include: contactInclude,
    });
    if (!row) throw notFound();
    return toView(row);
  }

  async update(workspaceId: string, rawId: string, userId: string, patch: UpdateContactInput): Promise<ContactView> {
    const data: Prisma.contactsUncheckedUpdateManyInput = { updated_by: BigInt(userId) };
    if (patch.displayName !== undefined) data.display_name = patch.displayName;
    if (patch.firstName !== undefined) data.first_name = patch.firstName;
    if (patch.lastName !== undefined) data.last_name = patch.lastName;
    if (patch.organization !== undefined) data.organization = patch.organization;
    if (patch.jobTitle !== undefined) data.job_title = patch.jobTitle;
    if (patch.department !== undefined) data.department = patch.department;
    if (patch.notes !== undefined) data.notes = patch.notes;
    if (patch.reviewStatus !== undefined) data.review_status = patch.reviewStatus;

    const { count } = await this.prisma.contacts.updateMany({
      where: { id: parseId(rawId), workspace_id: BigInt(workspaceId), ...LIVE },
      data,
    });
    if (count === 0) throw notFound();
    return this.get(workspaceId, rawId);
  }

  /** Soft delete: the contact and everything hanging off it. The record it came from (e.g. a scan) is not touched. */
  async remove(workspaceId: string, rawId: string, userId: string): Promise<void> {
    const id = parseId(rawId);
    const workspace = BigInt(workspaceId);
    const gone = { is_deleted: true, deleted_at: new Date(), deleted_by: BigInt(userId) };
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.contacts.updateMany({ where: { id, workspace_id: workspace, ...LIVE }, data: gone });
      if (count === 0) throw notFound();
      const children = { contact_id: id, workspace_id: workspace, ...LIVE };
      await tx.contact_methods.updateMany({ where: children, data: gone });
      await tx.contact_addresses.updateMany({ where: children, data: gone });
      await tx.contact_entity_links.updateMany({ where: children, data: gone });
    });
  }

  /**
   * Saves a person handed over by another module, INSIDE the caller's transaction, and links the contact to the record it came
   * from (entity type + entity id). If a live contact of this workspace already has one of the person's e-mail addresses, that
   * contact is reused instead of duplicated: only blank fields are filled and missing methods are added, nothing is overwritten.
   */
  async saveFromSource(
    tx: Prisma.TransactionClient,
    input: SaveFromSourceInput,
  ): Promise<{ contactId: bigint; created: boolean }> {
    const [entityType, sourceType] = await Promise.all([
      tx.entity_types.findFirst({ where: { code: input.entityTypeCode, ...LIVE }, select: { id: true } }),
      tx.contact_source_types.findFirst({ where: { code: input.sourceTypeCode, ...LIVE }, select: { id: true } }),
    ]);
    if (!entityType || !sourceType) {
      throw new InternalServerErrorException({
        code: 'CONTACT_SETUP_MISSING',
        message: 'Contacts are not set up correctly. Contact an administrator.',
      });
    }

    const { person, workspaceId, userId } = input;
    const existing = await this.findByEmail(tx, workspaceId, person);
    let contactId: bigint;
    let created = false;

    if (existing) {
      contactId = existing;
      await this.fillMissing(tx, workspaceId, userId, contactId, person);
    } else {
      created = true;
      const contact = await tx.contacts.create({
        data: {
          workspace_id: workspaceId,
          display_name: person.displayName,
          first_name: person.firstName,
          last_name: person.lastName,
          organization: person.organization,
          job_title: person.jobTitle,
          department: person.department,
          source_type_id: sourceType.id,
          source_record_id: input.entityId,
          created_by: userId,
        },
        select: { id: true },
      });
      contactId = contact.id;
      await this.addMethods(tx, workspaceId, userId, contactId, person.methods, new Set());
      if (person.address) await this.addAddress(tx, workspaceId, userId, contactId, person.address);
    }

    await tx.contact_entity_links.createMany({
      data: [
        {
          workspace_id: workspaceId,
          contact_id: contactId,
          entity_type_id: entityType.id,
          entity_id: input.entityId,
          relationship_type: 'source',
          created_by: userId,
        },
      ],
      skipDuplicates: true,
    });
    return { contactId, created };
  }

  private async findByEmail(tx: Prisma.TransactionClient, workspaceId: bigint, person: ContactPerson) {
    const emails = person.methods.filter((m) => m.type === 'email').map((m) => m.value.trim().toLowerCase());
    if (emails.length === 0) return null;
    const match = await tx.contact_methods.findFirst({
      where: {
        workspace_id: workspaceId,
        method_type: 'email',
        value: { in: emails },
        ...LIVE,
        contacts: { ...LIVE },
      },
      orderBy: { id: 'asc' },
      select: { contact_id: true },
    });
    return match?.contact_id ?? null;
  }

  private async fillMissing(
    tx: Prisma.TransactionClient,
    workspaceId: bigint,
    userId: bigint,
    contactId: bigint,
    person: ContactPerson,
  ): Promise<void> {
    const current = await tx.contacts.findFirstOrThrow({
      where: { id: contactId, workspace_id: workspaceId },
      include: {
        contact_methods: { where: LIVE, select: { method_type: true, value: true } },
        contact_addresses: { where: LIVE, select: { id: true }, take: 1 },
      },
    });

    const blanks: Prisma.contactsUncheckedUpdateInput = {};
    if (!current.first_name && person.firstName) blanks.first_name = person.firstName;
    if (!current.last_name && person.lastName) blanks.last_name = person.lastName;
    if (!current.organization && person.organization) blanks.organization = person.organization;
    if (!current.job_title && person.jobTitle) blanks.job_title = person.jobTitle;
    if (!current.department && person.department) blanks.department = person.department;
    if (Object.keys(blanks).length > 0) {
      await tx.contacts.update({ where: { id: contactId }, data: { ...blanks, updated_by: userId } });
    }

    const known = new Set(current.contact_methods.map((m) => methodKey(m.method_type, m.value)));
    await this.addMethods(tx, workspaceId, userId, contactId, person.methods, known);
    if (person.address && current.contact_addresses.length === 0) {
      await this.addAddress(tx, workspaceId, userId, contactId, person.address);
    }
  }

  /** Adds the methods that are not already there. The first e-mail and the first phone of a NEW contact are primary. */
  private async addMethods(
    tx: Prisma.TransactionClient,
    workspaceId: bigint,
    userId: bigint,
    contactId: bigint,
    methods: ContactMethodInput[],
    known: Set<string>,
  ): Promise<void> {
    // A kind the contact already has keeps its primary; the first e-mail / phone of a kind it lacks becomes the primary.
    const haveKind = new Set([...known].map((key) => key.split(':')[0]));
    const rows = [];
    for (const method of methods) {
      const key = methodKey(method.type, method.value);
      if (known.has(key)) continue;
      known.add(key);
      const primary = (method.type === 'email' || method.type === 'phone') && !haveKind.has(method.type);
      if (primary) haveKind.add(method.type);
      rows.push({
        workspace_id: workspaceId,
        contact_id: contactId,
        method_type: method.type,
        label: method.label,
        value: method.value,
        is_primary: primary,
        created_by: userId,
      });
    }
    if (rows.length > 0) await tx.contact_methods.createMany({ data: rows });
  }

  private async addAddress(
    tx: Prisma.TransactionClient,
    workspaceId: bigint,
    userId: bigint,
    contactId: bigint,
    address: NonNullable<ContactPerson['address']>,
  ): Promise<void> {
    if (!address.line1 && !address.city && !address.region && !address.postalCode && !address.country) return;
    await tx.contact_addresses.create({
      data: {
        workspace_id: workspaceId,
        contact_id: contactId,
        address_type: 'work',
        line1: address.line1,
        city: address.city,
        region: address.region,
        postal_code: address.postalCode,
        country: address.country,
        created_by: userId,
      },
    });
  }
}

function pick(row: SummaryRow, type: string): string | null {
  return row.contact_methods.find((m) => m.method_type === type)?.value ?? null;
}

function toSummary(row: SummaryRow): ContactSummary {
  return {
    id: row.id.toString(),
    displayName: row.display_name,
    organization: row.organization,
    jobTitle: row.job_title,
    email: pick(row, 'email'),
    phone: pick(row, 'phone'),
    reviewStatus: row.review_status,
    createdAt: row.created_at.toISOString(),
  };
}

function toView(row: ContactRow): ContactView {
  return {
    id: row.id.toString(),
    displayName: row.display_name,
    firstName: row.first_name,
    lastName: row.last_name,
    organization: row.organization,
    jobTitle: row.job_title,
    department: row.department,
    notes: row.notes,
    reviewStatus: row.review_status,
    source: { type: row.contact_source_types?.code ?? null, recordId: row.source_record_id?.toString() ?? null },
    methods: row.contact_methods.map((m) => ({
      id: m.id.toString(),
      type: m.method_type,
      label: m.label,
      value: m.value,
      isPrimary: m.is_primary,
    })),
    addresses: row.contact_addresses.map((a) => ({
      id: a.id.toString(),
      line1: a.line1,
      city: a.city,
      region: a.region,
      postalCode: a.postal_code,
      country: a.country,
    })),
    links: row.contact_entity_links.map((l) => ({
      entityType: l.entity_types.code,
      entityId: l.entity_id.toString(),
      relationship: l.relationship_type,
    })),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at?.toISOString() ?? null,
  };
}
