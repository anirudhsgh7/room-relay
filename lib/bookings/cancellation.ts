import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getProfileById, type UserProfile } from "@/lib/auth/service";
import type { RoomRelayDatabase } from "@/lib/db/client";
import type { BookingStatus } from "@/lib/domain";

interface CancellationBookingRow {
  id: string;
  room_code: string;
  requester_id: string;
  start_at: string;
  status: BookingStatus;
}

export interface CancellationReceipt {
  bookingId: string;
  status: "cancelled";
  cancelledAt: string;
  cancellationReason: string;
  priorStatus: BookingStatus;
}

export type CancellationResult =
  | { ok: true; kind: "cancelled"; receipt: CancellationReceipt }
  | {
      ok: false;
      kind: "validation";
      message: string;
      fieldErrors: { reason?: string };
    }
  | { ok: false; kind: "forbidden" | "not_found"; message: string }
  | {
      ok: false;
      kind: "not_cancellable";
      message: string;
      currentStatus: BookingStatus;
    }
  | {
      ok: false;
      kind: "state_changed";
      message: string;
      currentStatus: BookingStatus;
    }
  | {
      ok: false;
      kind: "service_error";
      message: string;
      correlationId: string;
    };

const cancellationSchema = z.object({
  bookingId: z.string().trim().min(1).max(100),
  reason: z
    .string()
    .trim()
    .min(5, "Enter a cancellation reason of at least 5 characters.")
    .max(500, "Keep the cancellation reason under 500 characters."),
});

function loadBooking(
  db: RoomRelayDatabase,
  bookingId: string,
): CancellationBookingRow | null {
  const row = db
    .prepare(
      `SELECT
         b.id, b.requester_id, b.start_at, b.status,
         r.code AS room_code
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       WHERE b.id = ?`,
    )
    .get(bookingId) as CancellationBookingRow | undefined;

  return row ?? null;
}

export function cancelOwnBooking(
  db: RoomRelayDatabase,
  actor: UserProfile,
  input: { bookingId: string; reason: string },
): CancellationResult {
  const parsed = cancellationSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      kind: "validation",
      message:
        parsed.error.issues[0]?.message ?? "Check the cancellation reason.",
      fieldErrors: {
        reason: parsed.error.issues[0]?.message,
      },
    };
  }

  const correlationId = randomUUID();

  try {
    const execute = db.transaction((): CancellationResult => {
      const freshActor = getProfileById(db, actor.id);

      if (!freshActor) {
        return {
          ok: false,
          kind: "forbidden",
          message: "Your account cannot perform this action.",
        };
      }

      const booking = loadBooking(db, parsed.data.bookingId);

      if (!booking || booking.requester_id !== freshActor.id) {
        return {
          ok: false,
          kind: "not_found",
          message: "That booking could not be found.",
        };
      }

      if (booking.status === "cancelled") {
        return {
          ok: false,
          kind: "not_cancellable",
          message: "This booking is already cancelled.",
          currentStatus: booking.status,
        };
      }

      const canCancelPending = booking.status === "pending";
      const canCancelApproved =
        booking.status === "approved" && Date.parse(booking.start_at) > Date.now();

      if (!canCancelPending && !canCancelApproved) {
        return {
          ok: false,
          kind: "not_cancellable",
          message:
            booking.status === "approved"
              ? "This approved booking has started and can no longer be cancelled."
              : "This booking can no longer be cancelled.",
          currentStatus: booking.status,
        };
      }

      const nowIso = new Date().toISOString();
      const priorStatus = booking.status;
      const update = db
        .prepare(
          `UPDATE bookings
           SET status = 'cancelled',
               cancelled_by = @cancelled_by,
               cancelled_at = @cancelled_at,
               cancellation_reason = @cancellation_reason,
               updated_at = @updated_at
           WHERE id = @id
             AND requester_id = @requester_id
             AND status = @prior_status`,
        )
        .run({
          id: booking.id,
          requester_id: freshActor.id,
          prior_status: priorStatus,
          cancelled_by: freshActor.id,
          cancelled_at: nowIso,
          cancellation_reason: parsed.data.reason,
          updated_at: nowIso,
        });

      if (update.changes !== 1) {
        const current = loadBooking(db, booking.id);
        return {
          ok: false,
          kind: "state_changed",
          message: "This booking was already updated. Refresh to see its current state.",
          currentStatus: current?.status ?? booking.status,
        };
      }

      db.prepare(
        `INSERT INTO audit_events (
           id, actor_id, action, entity_type, entity_id, occurred_at,
           summary, correlation_id, metadata_json
         ) VALUES (
           @id, @actor_id, 'booking.cancelled', 'booking', @entity_id,
           @occurred_at, @summary, @correlation_id, @metadata_json
         )`,
      ).run({
        id: `audit_${randomUUID()}`,
        actor_id: freshActor.id,
        entity_id: booking.id,
        occurred_at: nowIso,
        summary: `${freshActor.displayName} cancelled a ${priorStatus} request for ${booking.room_code}.`,
        correlation_id: `booking-cancellation:${correlationId}`,
        metadata_json: JSON.stringify({
          reason: parsed.data.reason,
          priorStatus,
          roomCode: booking.room_code,
        }),
      });

      return {
        ok: true,
        kind: "cancelled",
        receipt: {
          bookingId: booking.id,
          status: "cancelled",
          cancelledAt: nowIso,
          cancellationReason: parsed.data.reason,
          priorStatus,
        },
      };
    });

    return execute.immediate();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    if (message.includes("INVALID_CANCELLATION_METADATA")) {
      return {
        ok: false,
        kind: "forbidden",
        message: "This booking cannot be cancelled by your account.",
      };
    }

    console.error("Booking cancellation failed:", correlationId, message);

    return {
      ok: false,
      kind: "service_error",
      message: "The cancellation could not be saved. Please try again.",
      correlationId,
    };
  }
}
