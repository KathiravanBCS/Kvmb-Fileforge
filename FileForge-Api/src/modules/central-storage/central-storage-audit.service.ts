import { isIP } from 'node:net';

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import type { Actor } from './types/central-storage.types';

/** Only ids, sizes and codes: never file contents, tokens, secrets or file names. */
export type AuditDetails = Record<string, string | number | boolean | null>;

/**
 * Writes the append-only audit trail (audit.events) for central storage. Administrator actions on OTHER users' files
 * are recorded BEFORE they happen and a failure to record stops the action (fail closed): an admin cannot touch
 * someone's file without leaving a trace.
 */
@Injectable()
export class CentralStorageAuditService {
  private readonly logger = new Logger(CentralStorageAuditService.name);
  private readonly entityTypeIds = new Map<string, bigint>();

  constructor(private readonly prisma: PrismaService) {}

  async record(
    actor: Actor,
    action: string,
    entity: { type: string; id?: bigint | null },
    details: AuditDetails = {},
  ): Promise<void> {
    await this.prisma.events.create({
      data: {
        actor_user_id: actor.userId,
        actor_type: actor.isAdmin ? 'system_admin' : 'user',
        action,
        entity_type_id: await this.entityTypeId(entity.type),
        entity_id: entity.id ?? null,
        new_values: details,
        request_id: actor.requestId ?? null,
        // audit.events.ip_address is an INET column: anything that is not a valid address is dropped, not stored.
        ip_address: actor.ip && isIP(actor.ip) ? actor.ip : null,
      },
    });
  }

  /** An action taken by the server itself (the recovery worker), not by a person. */
  async recordSystem(
    action: string,
    entity: { type: string; id?: bigint | null },
    details: AuditDetails = {},
  ): Promise<void> {
    await this.prisma.events.create({
      data: {
        actor_user_id: null,
        actor_type: 'system',
        action,
        entity_type_id: await this.entityTypeId(entity.type),
        entity_id: entity.id ?? null,
        new_values: details,
      },
    });
  }

  private async entityTypeId(code: string): Promise<bigint | null> {
    const cached = this.entityTypeIds.get(code);
    if (cached !== undefined) return cached;
    const row = await this.prisma.entity_types.findFirst({ where: { code, is_deleted: false }, select: { id: true } });
    if (!row) {
      // The migration seeds these codes. Missing is a deployment problem, not a reason to lose the audit row.
      this.logger.warn({ event: 'central_audit_entity_type_missing', code });
      return null;
    }
    this.entityTypeIds.set(code, row.id);
    return row.id;
  }
}
