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
export async function recordAudit(
  db: RoomRelayDatabase,
  input: AuditInput,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_events (
         id, actor_id, action, entity_type, entity_id, occurred_at,
         summary, correlation_id, metadata_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run([
      `audit_${randomUUID()}`,
      input.actorId,
      input.action,
      input.entityType,
      input.entityId,
      input.occurredAt,
      input.summary,
      input.correlationId,
      JSON.stringify(input.metadata ?? {}),
    ]);
}
