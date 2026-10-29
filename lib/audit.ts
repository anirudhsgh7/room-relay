import { randomUUID } from "node:crypto";
import type { RoomRelayDatabase } from "@/lib/db/client";

export interface AuditInput {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
  summary: string;
  correlationId: string;
  metadata?: Record<string, unknown>;
}

/** Appends one audit event. Audit rows can never be edited or deleted. */
export function recordAudit(db: RoomRelayDatabase, input: AuditInput): void {
  db.prepare(
    `INSERT INTO audit_events (
       id, actor_id, action, entity_type, entity_id, occurred_at,
       summary, correlation_id, metadata_json
     ) VALUES (
       @id, @actor_id, @action, @entity_type, @entity_id, @occurred_at,
       @summary, @correlation_id, @metadata_json
     )`,
  ).run({
    id: `audit_${randomUUID()}`,
    actor_id: input.actorId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    occurred_at: input.occurredAt,
    summary: input.summary,
    correlation_id: input.correlationId,
    metadata_json: JSON.stringify(input.metadata ?? {}),
  });
}
