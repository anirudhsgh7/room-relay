import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getProfileById, type UserProfile } from "@/lib/auth/service";
import type { RoomRelayDatabase } from "@/lib/db/client";
import type { IncidentStatus } from "@/lib/incidents/constants";

interface IncidentRow {
  id: string;
  booking_id: string;
  status: IncidentStatus;
  room_id: string;
  room_code: string;
  room_name: string;
  room_manager_id: string;
}

export interface IncidentReceipt {
  incidentId: string;
  status: "reviewing" | "resolved";
  bookingCompleted: boolean;
}

export type IncidentActionResult =
  | { ok: true; kind: "updated"; receipt: IncidentReceipt }
  | {
      ok: false;
      kind: "validation";
      message: string;
      fieldErrors: { note?: string };
    }
  | { ok: false; kind: "forbidden" | "not_found"; message: string }
  | {
      ok: false;
      kind: "not_available";
      message: string;
      currentStatus: IncidentStatus;
    }
  | {
      ok: false;
      kind: "service_error";
      message: string;
      correlationId: string;
    };

const reviewSchema = z.object({
  incidentId: z.string().trim().min(1).max(100),
  note: z
    .string()
    .trim()
    .min(10, "Enter a review note of at least 10 characters.")
    .max(1000, "Keep the review note under 1,000 characters."),
});

const resolveSchema = z.object({
  incidentId: z.string().trim().min(1).max(100),
  resolutionNote: z
    .string()
    .trim()
    .min(10, "Enter a resolution note of at least 10 characters.")
    .max(1500, "Keep the resolution note under 1,500 characters."),
});

function loadIncident(
  db: RoomRelayDatabase,
  incidentId: string,
): IncidentRow | null {
  const row = db
    .prepare(
      `SELECT
         i.id, i.booking_id, i.status,
         b.room_id, r.code AS room_code, r.name AS room_name,
         r.manager_id AS room_manager_id
       FROM incidents i
       JOIN bookings b ON b.id = i.booking_id
       JOIN rooms r ON r.id = b.room_id
       WHERE i.id = ?`,
    )
    .get(incidentId) as IncidentRow | undefined;

  return row ?? null;
}

function canReviewIncident(
  actor: UserProfile,
  incident: IncidentRow,
): boolean {
  if (actor.role === "admin") {
    return true;
  }

  return (
    actor.role === "manager" && incident.room_manager_id === actor.id
  );
}

function insertAudit(
  db: RoomRelayDatabase,
  input: {
    actor: UserProfile;
    action: string;
    entityType: "incident" | "booking";
    entityId: string;
    occurredAt: string;
    summary: string;
    correlationId: string;
    metadata: Record<string, unknown>;
  },
): void {
  db.prepare(
    `INSERT INTO audit_events (
       id, actor_id, action, entity_type, entity_id, occurred_at,
       summary, correlation_id, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `audit_${randomUUID()}`,
    input.actor.id,
    input.action,
    input.entityType,
    input.entityId,
    input.occurredAt,
    input.summary,
    input.correlationId,
    JSON.stringify(input.metadata),
  );
}

/** Manager/admin starts a review for an assigned-room incident. */
export function reviewIncident(
  db: RoomRelayDatabase,
  actor: UserProfile,
  input: { incidentId: string; note: string },
): IncidentActionResult {
  const parsed = reviewSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      kind: "validation",
      message:
        parsed.error.issues[0]?.message ?? "Check the review note.",
      fieldErrors: {
        note: parsed.error.issues[0]?.message,
      },
    };
  }

  const correlationId = randomUUID();

  try {
    const execute = db.transaction((): IncidentActionResult => {
      const freshActor = getProfileById(db, actor.id);

      if (!freshActor) {
        return {
          ok: false,
          kind: "forbidden",
          message: "Your account cannot review incidents.",
        };
      }

      const incident = loadIncident(db, parsed.data.incidentId);

      if (!incident || !canReviewIncident(freshActor, incident)) {
        return {
          ok: false,
          kind: "not_found",
          message: "That incident could not be found.",
        };
      }

      if (incident.status !== "open") {
        return {
          ok: false,
          kind: "not_available",
          message:
            incident.status === "reviewing"
              ? "This incident is already in review."
              : "This incident has already been resolved.",
          currentStatus: incident.status,
        };
      }

      const nowIso = new Date().toISOString();
      const update = db
        .prepare(
          `UPDATE incidents
           SET status = 'reviewing',
               manager_reviewed_by = ?,
               manager_reviewed_at = ?,
               manager_review_note = ?,
               updated_at = ?
           WHERE id = ? AND status = 'open'`,
        )
        .run(
          freshActor.id,
          nowIso,
          parsed.data.note,
          nowIso,
          incident.id,
        );

      if (update.changes !== 1) {
        return {
          ok: false,
          kind: "not_available",
          message: "This incident was already updated.",
          currentStatus: incident.status,
        };
      }

      insertAudit(db, {
        actor: freshActor,
        action: "incident.review_started",
        entityType: "incident",
        entityId: incident.id,
        occurredAt: nowIso,
        summary: `${freshActor.displayName} started review of an incident for ${incident.room_name}.`,
        correlationId: `incident-review:${correlationId}`,
        metadata: {
          bookingId: incident.booking_id,
          roomCode: incident.room_code,
          reviewNote: parsed.data.note,
        },
      });

      return {
        ok: true,
        kind: "updated",
        receipt: {
          incidentId: incident.id,
          status: "reviewing",
          bookingCompleted: false,
        },
      };
    });

    return execute.immediate();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    if (
      message.includes("INVALID_INCIDENT_TRANSITION") ||
      message.includes("INVALID_INCIDENT_REVIEW")
    ) {
      return {
        ok: false,
        kind: "not_available",
        message: "The incident could not be reviewed in its current state.",
        currentStatus: "open",
      };
    }

    console.error("Incident review failed:", correlationId, message);

    return {
      ok: false,
      kind: "service_error",
      message: "The review could not be saved. Please try again.",
      correlationId,
    };
  }
}

/** Administrator records final resolution; may complete the linked booking. */
export function resolveIncident(
  db: RoomRelayDatabase,
  actor: UserProfile,
  input: { incidentId: string; resolutionNote: string },
): IncidentActionResult {
  const parsed = resolveSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      kind: "validation",
      message:
        parsed.error.issues[0]?.message ?? "Check the resolution note.",
      fieldErrors: {
        note: parsed.error.issues[0]?.message,
      },
    };
  }

  const correlationId = randomUUID();

  try {
    const execute = db.transaction((): IncidentActionResult => {
      const freshActor = getProfileById(db, actor.id);

      if (!freshActor || freshActor.role !== "admin") {
        return {
          ok: false,
          kind: "forbidden",
          message: "Only an administrator can finalize incident resolution.",
        };
      }

      const incident = loadIncident(db, parsed.data.incidentId);

      if (!incident) {
        return {
          ok: false,
          kind: "not_found",
          message: "That incident could not be found.",
        };
      }

      if (
        incident.status !== "open" &&
        incident.status !== "reviewing"
      ) {
        return {
          ok: false,
          kind: "not_available",
          message: "This incident has already been resolved.",
          currentStatus: incident.status,
        };
      }

      const nowIso = new Date().toISOString();
      const update = db
        .prepare(
          `UPDATE incidents
           SET status = 'resolved',
               reviewer_id = ?,
               resolution_note = ?,
               resolved_at = ?,
               updated_at = ?
           WHERE id = ? AND status IN ('open', 'reviewing')`,
        )
        .run(
          freshActor.id,
          parsed.data.resolutionNote,
          nowIso,
          nowIso,
          incident.id,
        );

      if (update.changes !== 1) {
        return {
          ok: false,
          kind: "not_available",
          message: "This incident was already updated.",
          currentStatus: incident.status,
        };
      }

      insertAudit(db, {
        actor: freshActor,
        action: "incident.resolved",
        entityType: "incident",
        entityId: incident.id,
        occurredAt: nowIso,
        summary: `${freshActor.displayName} finalized an incident resolution for ${incident.room_name}.`,
        correlationId: `incident-resolution:${correlationId}`,
        metadata: {
          bookingId: incident.booking_id,
          roomCode: incident.room_code,
          resolutionNote: parsed.data.resolutionNote,
        },
      });

      const unresolved = db
        .prepare(
          `SELECT count(*) AS count
           FROM incidents
           WHERE booking_id = ?
             AND status IN ('open', 'reviewing')`,
        )
        .get(incident.booking_id) as { count: number };

      let bookingCompleted = false;

      if (unresolved.count === 0) {
        const completeBooking = db
          .prepare(
            `UPDATE bookings
             SET status = 'completed',
                 closed_at = ?,
                 closure_reason = 'incident_resolved',
                 updated_at = ?
             WHERE id = ? AND status = 'incident'`,
          )
          .run(nowIso, nowIso, incident.booking_id);

        if (completeBooking.changes === 1) {
          bookingCompleted = true;
          insertAudit(db, {
            actor: freshActor,
            action: "booking.completed",
            entityType: "booking",
            entityId: incident.booking_id,
            occurredAt: nowIso,
            summary: `All incidents were resolved; the booking for ${incident.room_name} was completed.`,
            correlationId: `booking-completed:${correlationId}`,
            metadata: {
              closureReason: "incident_resolved",
              incidentId: incident.id,
            },
          });
        }
      }

      return {
        ok: true,
        kind: "updated",
        receipt: {
          incidentId: incident.id,
          status: "resolved",
          bookingCompleted,
        },
      };
    });

    return execute.immediate();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    if (
      message.includes("INVALID_INCIDENT") ||
      message.includes("OPEN_INCIDENTS_REMAIN") ||
      message.includes("INVALID_BOOKING_TRANSITION")
    ) {
      return {
        ok: false,
        kind: "not_available",
        message: "The incident could not be resolved in its current state.",
        currentStatus: "reviewing",
      };
    }

    console.error("Incident resolution failed:", correlationId, message);

    return {
      ok: false,
      kind: "service_error",
      message: "The resolution could not be saved. Please try again.",
      correlationId,
    };
  }
}
