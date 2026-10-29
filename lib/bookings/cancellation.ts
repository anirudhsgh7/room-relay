import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getProfileById, type UserProfile } from "@/lib/auth/service";
import type { RoomRelayDatabase } from "@/lib/db/client";
import type { BookingStatus } from "@/lib/domain";
import { promoteWaitlist } from "@/lib/bookings/waitlist";
import {
  activeRoomManagerId,
  createNotification,
  requesterLink,
  reviewerLink,
} from "@/lib/notifications/service";
import { formatCampusDateTime } from "@/lib/time/campus-time";

interface CancellationBookingRow {
  id: string;
  room_id: string;
  room_code: string;
  room_name: string;
  manager_id: string;
  requester_id: string;
  requester_name: string;
  start_at: string;
  end_at: string;
  status: BookingStatus;
}

export interface CancellationReceipt {
  bookingId: string;
  status: "cancelled";
  cancelledAt: string;
  cancellationReason: string;
  priorStatus: BookingStatus;
  /** Waitlisted requests returned to review because this slot was freed. */
  promotedCount: number;
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

async function loadBooking(
  db: RoomRelayDatabase,
  bookingId: string,
): Promise<CancellationBookingRow | null> {
  const row = (await db
    .prepare(
      `SELECT
         b.id, b.room_id, b.requester_id, b.start_at, b.end_at, b.status,
         r.code AS room_code, r.name AS room_name, r.manager_id,
         requester.display_name AS requester_name
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       JOIN profiles requester ON requester.id = b.requester_id
       WHERE b.id = ?`,
    )
    .get(bookingId)) as CancellationBookingRow | undefined;

  return row ?? null;
}

export async function cancelOwnBooking(
  db: RoomRelayDatabase,
  actor: UserProfile,
  input: { bookingId: string; reason: string },
): Promise<CancellationResult> {
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
    const execute = db.transaction(async (): Promise<CancellationResult> => {
      const freshActor = await getProfileById(db, actor.id);

      if (!freshActor) {
        return {
          ok: false,
          kind: "forbidden",
          message: "Your account cannot perform this action.",
        };
      }

      const booking = await loadBooking(db, parsed.data.bookingId);

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

      const canCancelPending =
        booking.status === "pending" || booking.status === "waitlisted";
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
      const update = await db
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
        const current = await loadBooking(db, booking.id);
        return {
          ok: false,
          kind: "state_changed",
          message: "This booking was already updated. Refresh to see its current state.",
          currentStatus: current?.status ?? booking.status,
        };
      }

      await db.prepare(
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
        summary:
          priorStatus === "waitlisted"
            ? `${freshActor.displayName} left the waitlist for ${booking.room_code}.`
            : `${freshActor.displayName} cancelled a ${priorStatus} request for ${booking.room_code}.`,
        correlation_id: `booking-cancellation:${correlationId}`,
        metadata_json: JSON.stringify({
          reason: parsed.data.reason,
          priorStatus,
          roomCode: booking.room_code,
        }),
      });

      let promotedCount = 0;

      if (priorStatus === "approved") {
        const managerId = await activeRoomManagerId(db, booking.room_id);

        if (managerId) {
          await createNotification(db, {
            recipientId: managerId,
            kind: "booking_cancelled",
            title: `Booking cancelled: ${booking.room_name}`,
            body: `${freshActor.displayName} cancelled their approved booking for ${formatCampusDateTime(
              booking.start_at,
              booking.end_at,
            )}. Reason: ${parsed.data.reason}`,
            linkPath: reviewerLink(booking.id),
            bookingId: booking.id,
            createdAt: nowIso,
          });
        }

        promotedCount = (await promoteWaitlist(db, {
          roomId: booking.room_id,
          freedStartAt: booking.start_at,
          freedEndAt: booking.end_at,
          nowIso,
          correlationId,
          cause: "the booking holding it was cancelled",
        })).length;
      }

      return {
        ok: true,
        kind: "cancelled",
        receipt: {
          bookingId: booking.id,
          status: "cancelled",
          cancelledAt: nowIso,
          cancellationReason: parsed.data.reason,
          priorStatus,
          promotedCount,
        },
      };
    });

    return await execute.immediate();
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

/**
 * Cancels a booking on behalf of the room manager or an administrator (for
 * example an emergency closure). Runs inside the caller's transaction so bulk
 * operations such as a new blackout commit or roll back as one unit.
 * Returns the prior status, or null if the booking was not in a cancellable
 * state when the update ran.
 */
export async function cancelAsStaffInTransaction(
  db: RoomRelayDatabase,
  input: {
    actor: UserProfile;
    bookingId: string;
    reason: string;
    nowIso: string;
    correlationId: string;
    /** When false, the freed slot is not offered to the waitlist (closures). */
    releaseToWaitlist: boolean;
  },
): Promise<{ priorStatus: BookingStatus; promotedCount: number } | null> {
  const booking = await loadBooking(db, input.bookingId);

  if (
    !booking ||
    !(
      booking.status === "pending" ||
      booking.status === "waitlisted" ||
      booking.status === "approved"
    )
  ) {
    return null;
  }

  const priorStatus = booking.status;
  const update = await db
    .prepare(
      `UPDATE bookings
       SET status = 'cancelled',
           cancelled_by = @cancelled_by,
           cancelled_at = @now,
           cancellation_reason = @reason,
           updated_at = @now
       WHERE id = @id AND status = @prior_status`,
    )
    .run({
      id: booking.id,
      cancelled_by: input.actor.id,
      now: input.nowIso,
      reason: input.reason,
      prior_status: priorStatus,
    });

  if (update.changes !== 1) {
    return null;
  }

  await db.prepare(
    `INSERT INTO audit_events (
       id, actor_id, action, entity_type, entity_id, occurred_at,
       summary, correlation_id, metadata_json
     ) VALUES (
       @id, @actor_id, 'booking.cancelled', 'booking', @entity_id,
       @occurred_at, @summary, @correlation_id, @metadata_json
     )`,
  ).run({
    id: `audit_${randomUUID()}`,
    actor_id: input.actor.id,
    entity_id: booking.id,
    occurred_at: input.nowIso,
    summary: `${input.actor.displayName} cancelled ${booking.requester_name}'s ${priorStatus} booking for ${booking.room_code}.`,
    correlation_id: `booking-staff-cancellation:${input.correlationId}`,
    metadata_json: JSON.stringify({
      reason: input.reason,
      priorStatus,
      roomCode: booking.room_code,
      byStaff: true,
    }),
  });

  await createNotification(db, {
    recipientId: booking.requester_id,
    kind: "booking_cancelled_by_staff",
    title:
      priorStatus === "approved"
        ? `Booking cancelled: ${booking.room_name}`
        : `Request withdrawn: ${booking.room_name}`,
    body: `Your ${
      priorStatus === "approved"
        ? "booking"
        : priorStatus === "waitlisted"
          ? "waitlist place"
          : "request"
    } for ${formatCampusDateTime(booking.start_at, booking.end_at)} was cancelled by ${
      input.actor.displayName
    }. Reason: ${input.reason}`,
    linkPath: requesterLink(booking.id),
    bookingId: booking.id,
    createdAt: input.nowIso,
  });

  let promotedCount = 0;

  if (priorStatus === "approved" && input.releaseToWaitlist) {
    promotedCount = (await promoteWaitlist(db, {
      roomId: booking.room_id,
      freedStartAt: booking.start_at,
      freedEndAt: booking.end_at,
      nowIso: input.nowIso,
      correlationId: input.correlationId,
      cause: "staff cancelled the booking holding it",
    })).length;
  }

  return { priorStatus, promotedCount };
}

const staffCancellationSchema = z.object({
  bookingId: z.string().trim().min(1).max(100),
  reason: z
    .string()
    .trim()
    .min(10, "Explain the cancellation in at least 10 characters. The requester will see it.")
    .max(500, "Keep the reason under 500 characters."),
});

/** A room manager or administrator cancels one booking with a stated reason. */
export async function cancelBookingAsStaff(
  db: RoomRelayDatabase,
  actor: UserProfile,
  input: { bookingId: string; reason: string },
): Promise<CancellationResult> {
  const parsed = staffCancellationSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      kind: "validation",
      message: parsed.error.issues[0]?.message ?? "Check the cancellation reason.",
      fieldErrors: { reason: parsed.error.issues[0]?.message },
    };
  }

  const correlationId = randomUUID();

  try {
    const execute = db.transaction(async (): Promise<CancellationResult> => {
      const freshActor = await getProfileById(db, actor.id);

      if (
        !freshActor ||
        freshActor.status !== "active" ||
        (freshActor.role !== "manager" && freshActor.role !== "admin")
      ) {
        return {
          ok: false,
          kind: "forbidden",
          message: "You do not have permission to cancel bookings.",
        };
      }

      const booking = await loadBooking(db, parsed.data.bookingId);

      if (
        !booking ||
        (freshActor.role === "manager" && booking.manager_id !== freshActor.id)
      ) {
        return {
          ok: false,
          kind: "not_found",
          message: "That booking could not be found.",
        };
      }

      if (
        booking.status !== "pending" &&
        booking.status !== "waitlisted" &&
        booking.status !== "approved"
      ) {
        return {
          ok: false,
          kind: "not_cancellable",
          message:
            booking.status === "checked_in"
              ? "This booking is in use. It ends with the requester's check-out."
              : "This booking can no longer be cancelled.",
          currentStatus: booking.status,
        };
      }

      const nowIso = new Date().toISOString();
      const result = await cancelAsStaffInTransaction(db, {
        actor: freshActor,
        bookingId: booking.id,
        reason: parsed.data.reason,
        nowIso,
        correlationId,
        releaseToWaitlist: true,
      });

      if (!result) {
        const current = await loadBooking(db, booking.id);
        return {
          ok: false,
          kind: "state_changed",
          message: "This booking was already updated. Refresh to see its current state.",
          currentStatus: current?.status ?? booking.status,
        };
      }

      return {
        ok: true,
        kind: "cancelled",
        receipt: {
          bookingId: booking.id,
          status: "cancelled",
          cancelledAt: nowIso,
          cancellationReason: parsed.data.reason,
          priorStatus: result.priorStatus,
          promotedCount: result.promotedCount,
        },
      };
    });

    return await execute.immediate();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("Staff cancellation failed:", correlationId, message);

    return {
      ok: false,
      kind: "service_error",
      message: "The cancellation could not be saved. Please try again.",
      correlationId,
    };
  }
}
