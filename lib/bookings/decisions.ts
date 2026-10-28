import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getProfileById, type UserProfile } from "@/lib/auth/service";
import { isActiveProfile } from "@/lib/authorization";
import type { RoomRelayDatabase } from "@/lib/db/client";
import type { BookingStatus } from "@/lib/domain";
import { getBlockingBookings, checkRoomSchedule } from "@/lib/rooms/availability";
import { getRoomDetail } from "@/lib/rooms/queries";
import type { RoomRequirement } from "@/lib/rooms/types";
import { localIntervalParts } from "@/lib/time/campus-time";

type DecisionAction = "approve" | "reject";

interface DecisionInput {
  bookingId: string;
  action: DecisionAction;
  decisionReason: string;
  overrideRequirementIds: string[];
  overrideReason: string;
}

export interface DecisionFieldErrors {
  decisionReason?: string;
  overrideReason?: string;
  overrideRequirementIds?: string;
}

interface DecisionBookingRow {
  id: string;
  room_id: string;
  room_code: string;
  manager_id: string;
  requester_id: string;
  start_at: string;
  end_at: string;
  expected_attendance: number;
  status: BookingStatus;
}

export interface DecisionReceipt {
  bookingId: string;
  status: "approved" | "rejected";
  decidedAt: string;
  decisionReason: string;
}

export interface SafeRequirement {
  id: string;
  description: string;
}

export type DecisionResult =
  | { ok: true; kind: "decided"; receipt: DecisionReceipt }
  | {
      ok: false;
      kind: "validation";
      message: string;
      fieldErrors: DecisionFieldErrors;
    }
  | {
      ok: false;
      kind: "forbidden" | "not_found";
      message: string;
    }
  | {
      ok: false;
      kind: "already_decided" | "state_changed";
      message: string;
      currentStatus: BookingStatus;
    }
  | {
      ok: false;
      kind: "eligibility_required";
      message: string;
      requirements: SafeRequirement[];
    }
  | {
      ok: false;
      kind: "conflict" | "room_unavailable";
      message: string;
    }
  | {
      ok: false;
      kind: "service_error";
      message: string;
      correlationId: string;
    };

const decisionSchema = z.object({
  bookingId: z.string().trim().min(1).max(100),
  action: z.enum(["approve", "reject"]),
  decisionReason: z
    .string()
    .trim()
    .min(10, "Enter a decision reason of at least 10 characters.")
    .max(500, "Keep the decision reason under 500 characters."),
  overrideRequirementIds: z
    .array(z.string().trim().min(1).max(100))
    .max(20)
    .default([]),
  overrideReason: z
    .string()
    .trim()
    .max(500, "Keep the override reason under 500 characters.")
    .default(""),
});

function fieldErrors(error: z.ZodError): DecisionFieldErrors {
  const result: DecisionFieldErrors = {};

  for (const issue of error.issues) {
    const field = issue.path[0];
    if (
      field === "decisionReason" ||
      field === "overrideReason" ||
      field === "overrideRequirementIds"
    ) {
      if (!result[field]) {
        result[field] = issue.message;
      }
    }
  }

  return result;
}

function loadDecisionBooking(
  db: RoomRelayDatabase,
  bookingId: string,
): DecisionBookingRow | null {
  const row = db
    .prepare(
      `SELECT
         b.id, b.room_id, b.requester_id, b.start_at, b.end_at,
         b.expected_attendance, b.status,
         r.code AS room_code, r.manager_id
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       WHERE b.id = ?`,
    )
    .get(bookingId) as DecisionBookingRow | undefined;

  return row ?? null;
}

function canManageBookingRoom(
  actor: UserProfile,
  row: DecisionBookingRow,
): boolean {
  if (!isActiveProfile(actor)) {
    return false;
  }

  if (actor.role === "admin") {
    return true;
  }

  return actor.role === "manager" && row.manager_id === actor.id;
}

function insertDecisionAudit(
  db: RoomRelayDatabase,
  input: {
    actor: UserProfile;
    bookingId: string;
    action: "booking.approved" | "booking.rejected";
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
     ) VALUES (
       @id, @actor_id, @action, 'booking', @entity_id, @occurred_at,
       @summary, @correlation_id, @metadata_json
     )`,
  ).run({
    id: `audit_${randomUUID()}`,
    actor_id: input.actor.id,
    action: input.action,
    entity_id: input.bookingId,
    occurred_at: input.occurredAt,
    summary: input.summary,
    correlation_id: input.correlationId,
    metadata_json: JSON.stringify(input.metadata),
  });
}

function safeRequirements(requirements: RoomRequirement[]): SafeRequirement[] {
  return requirements.map((requirement) => ({
    id: requirement.id,
    description: requirement.description,
  }));
}

/**
 * Approve or reject one pending request. All checks run inside an immediate
 * SQLite transaction so current policy, eligibility, and conflicts cannot
 * change between validation and the update.
 */
export function decideBooking(
  db: RoomRelayDatabase,
  actor: UserProfile,
  input: DecisionInput,
): DecisionResult {
  const parsed = decisionSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      kind: "validation",
      message:
        parsed.error.issues[0]?.message ?? "Check the decision fields.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const uniqueRequirementIds = [...new Set(data.overrideRequirementIds)];

  if (data.action === "reject" && uniqueRequirementIds.length > 0) {
    return {
      ok: false,
      kind: "validation",
      message: "Eligibility overrides only apply to approvals.",
      fieldErrors: {
        overrideRequirementIds: "Remove the override when rejecting.",
      },
    };
  }

  if (uniqueRequirementIds.length > 0 && data.overrideReason.length < 20) {
    return {
      ok: false,
      kind: "validation",
      message: "Explain why eligibility is being overridden.",
      fieldErrors: {
        overrideReason: "Enter an override reason of at least 20 characters.",
      },
    };
  }

  const correlationId = randomUUID();

  try {
    const execute = db.transaction((): DecisionResult => {
      const freshActor = getProfileById(db, actor.id);

      if (!freshActor || (freshActor.role !== "manager" && freshActor.role !== "admin")) {
        return {
          ok: false,
          kind: "forbidden",
          message: "You do not have permission to review requests.",
        };
      }

      const booking = loadDecisionBooking(db, data.bookingId);

      if (!booking) {
        return {
          ok: false,
          kind: "not_found",
          message: "That request could not be found.",
        };
      }

      if (!canManageBookingRoom(freshActor, booking)) {
        return {
          ok: false,
          kind: "not_found",
          message: "That request could not be found.",
        };
      }

      if (booking.status !== "pending") {
        return {
          ok: false,
          kind: "already_decided",
          message: "This request has already been updated.",
          currentStatus: booking.status,
        };
      }

      const request = parsed.data;

      if (request.action === "reject") {
        const nowIso = new Date().toISOString();
        const update = db
          .prepare(
            `UPDATE bookings
             SET status = 'rejected',
                 decision_reason = @reason,
                 decided_by = @decided_by,
                 decided_at = @decided_at,
                 eligibility_override_reason = NULL,
                 eligibility_override_requirement_ids_json = NULL,
                 updated_at = @updated_at
             WHERE id = @id
               AND status = 'pending'`,
          )
          .run({
            id: booking.id,
            reason: request.decisionReason,
            decided_by: freshActor.id,
            decided_at: nowIso,
            updated_at: nowIso,
          });

        if (update.changes !== 1) {
          return {
            ok: false,
            kind: "state_changed",
            message: "This request was already updated.",
            currentStatus: booking.status,
          };
        }

        insertDecisionAudit(db, {
          actor: freshActor,
          bookingId: booking.id,
          action: "booking.rejected",
          occurredAt: nowIso,
          summary: `${freshActor.displayName} rejected a booking request for ${booking.room_code}.`,
          correlationId: `booking-rejection:${correlationId}`,
          metadata: {
            reason: request.decisionReason,
            roomCode: booking.room_code,
          },
        });

        return {
          ok: true,
          kind: "decided",
          receipt: {
            bookingId: booking.id,
            status: "rejected",
            decidedAt: nowIso,
            decisionReason: request.decisionReason,
          },
        };
      }

      const requester = getProfileById(db, booking.requester_id);

      if (!requester) {
        return {
          ok: false,
          kind: "room_unavailable",
          message:
            "The requester account is inactive, so this request cannot be approved.",
        };
      }

      const room = getRoomDetail(
        db,
        requester,
        booking.room_code,
        null,
      );

      if (!room) {
        return {
          ok: false,
          kind: "room_unavailable",
          message:
            "This room is no longer active. The request cannot be approved.",
        };
      }

      if (!room.policy.requestsEnabled) {
        return {
          ok: false,
          kind: "room_unavailable",
          message:
            "This room is not accepting requests. The request cannot be approved.",
        };
      }

      if (Date.parse(booking.start_at) <= Date.now()) {
        return {
          ok: false,
          kind: "room_unavailable",
          message:
            "This request's start time has passed. It can only be rejected now.",
        };
      }

      const local = localIntervalParts(
        booking.start_at,
        booking.end_at,
      );

      if (
        !local.sameLocalDate ||
        local.durationMinutes <= 0 ||
        local.durationMinutes > room.policy.maximumDurationMinutes ||
        local.startMinutes % room.policy.slotIntervalMinutes !== 0 ||
        local.endMinutes % room.policy.slotIntervalMinutes !== 0
      ) {
        return {
          ok: false,
          kind: "room_unavailable",
          message:
            "The request no longer meets the room's current time policy. It can only be rejected.",
        };
      }

      if (booking.expected_attendance > room.capacity) {
        return {
          ok: false,
          kind: "room_unavailable",
          message:
            "The expected attendance now exceeds the room's capacity. The request can only be rejected.",
        };
      }

      if (
        !checkRoomSchedule(
          db,
          room.id,
          local.date,
          local.weekday,
          local.startMinutes,
          local.endMinutes,
        )
      ) {
        return {
          ok: false,
          kind: "room_unavailable",
          message:
            "The requested interval is no longer within the room's opening hours.",
        };
      }

      const outstanding = room.requirements.filter(
        (requirement) =>
          requirement.required && requirement.verification !== "verified",
      );
      const outstandingIds = new Set(
        outstanding.map((requirement) => requirement.id),
      );
      const selectedIds = new Set(uniqueRequirementIds);

      if (selectedIds.size > 0) {
        const unknownSelection = [...selectedIds].some(
          (id) => !outstandingIds.has(id),
        );

        if (unknownSelection || outstanding.length === 0) {
          return {
            ok: false,
            kind: "validation",
            message:
              "The eligibility override does not match the current outstanding requirements.",
            fieldErrors: {
              overrideRequirementIds:
                "Refresh the request and select only current unmet requirements.",
            },
          };
        }
      }

      const unaddressed = outstanding.filter(
        (requirement) => !selectedIds.has(requirement.id),
      );

      if (unaddressed.length > 0) {
        return {
          ok: false,
          kind: "eligibility_required",
          message:
            "A required eligibility check is not verified. Verify it or use an authorized override with a recorded reason.",
          requirements: safeRequirements(unaddressed),
        };
      }

      const overrideReason =
        outstanding.length > 0 ? data.overrideReason : null;
      const overrideIds =
        outstanding.length > 0
          ? outstanding.map((requirement) => requirement.id)
          : [];

      const conflict = getBlockingBookings(
        db,
        room.id,
        booking.start_at,
        booking.end_at,
        room.policy.bufferMinutes,
      ).filter((blocker) => blocker.id !== booking.id);

      if (conflict.length > 0) {
        return {
          ok: false,
          kind: "conflict",
          message:
            "This request now overlaps a confirmed booking. No decision was saved.",
        };
      }

      const nowIso = new Date().toISOString();
      const update = db
        .prepare(
          `UPDATE bookings
           SET status = 'approved',
               decision_reason = @reason,
               decided_by = @decided_by,
               decided_at = @decided_at,
               eligibility_override_reason = @override_reason,
               eligibility_override_requirement_ids_json = @override_ids,
               updated_at = @updated_at
           WHERE id = @id
             AND status = 'pending'`,
        )
        .run({
          id: booking.id,
          reason: data.decisionReason,
          decided_by: freshActor.id,
          decided_at: nowIso,
          override_reason: overrideReason,
          override_ids:
            overrideIds.length > 0 ? JSON.stringify(overrideIds) : null,
          updated_at: nowIso,
        });

      if (update.changes !== 1) {
        return {
          ok: false,
          kind: "state_changed",
          message: "This request was already updated.",
          currentStatus: booking.status,
        };
      }

      insertDecisionAudit(db, {
        actor: freshActor,
        bookingId: booking.id,
        action: "booking.approved",
        occurredAt: nowIso,
        summary: `${freshActor.displayName} approved a booking request for ${booking.room_code}.`,
        correlationId: `booking-approval:${correlationId}`,
        metadata: {
          reason: data.decisionReason,
          roomCode: booking.room_code,
          startAt: booking.start_at,
          endAt: booking.end_at,
          eligibilityOverride:
            overrideIds.length > 0
              ? {
                  requirementIds: overrideIds,
                  reason: overrideReason,
                }
              : null,
        },
      });

      return {
        ok: true,
        kind: "decided",
        receipt: {
          bookingId: booking.id,
          status: "approved",
          decidedAt: nowIso,
          decisionReason: data.decisionReason,
        },
      };
    });

    return execute.immediate();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    if (message.includes("CONFIRMED_BOOKING_OVERLAP")) {
      return {
        ok: false,
        kind: "conflict",
        message:
          "This request now overlaps a confirmed booking. No decision was saved.",
      };
    }

    if (message.includes("INVALID_BOOKING_TRANSITION")) {
      return {
        ok: false,
        kind: "state_changed",
        message: "This request was already updated.",
        currentStatus: "pending",
      };
    }

    console.error("Booking decision failed:", correlationId, message);

    return {
      ok: false,
      kind: "service_error",
      message: "The decision could not be saved. Please try again.",
      correlationId,
    };
  }
}
