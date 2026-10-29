import { randomUUID } from "node:crypto";
import { promoteWaitlist } from "@/lib/bookings/waitlist";
import {
  activeRoomManagerId,
  createNotification,
} from "@/lib/notifications/service";
import { z } from "zod";
import { getProfileById, type UserProfile } from "@/lib/auth/service";
import type { RoomRelayDatabase } from "@/lib/db/client";
import type { BookingStatus } from "@/lib/domain";
import {
  CONDITION_STATES,
  INCIDENT_CATEGORIES,
  type IncidentCategory,
} from "@/lib/incidents/constants";

interface CheckoutBookingRow {
  id: string;
  room_id: string;
  room_code: string;
  room_name: string;
  requester_id: string;
  status: BookingStatus;
  start_at: string;
  end_at: string;
}

export interface CheckoutReceipt {
  bookingId: string;
  status: "completed" | "incident";
  checkedOutAt: string;
  conditionReportId: string;
  incidentId: string | null;
}

export interface CheckoutFieldErrors {
  notes?: string;
  incidentCategory?: string;
  issueDescription?: string;
}

export type CheckoutResult =
  | { ok: true; kind: "checked_out"; receipt: CheckoutReceipt }
  | {
      ok: false;
      kind: "validation";
      message: string;
      fieldErrors: CheckoutFieldErrors;
    }
  | {
      ok: false;
      kind: "forbidden" | "not_found";
      message: string;
    }
  | {
      ok: false;
      kind: "not_checkable";
      message: string;
      currentStatus: BookingStatus;
    }
  | {
      ok: false;
      kind: "service_error";
      message: string;
      correlationId: string;
    };

export interface CheckoutInput {
  bookingId: string;
  conditionState: (typeof CONDITION_STATES)[number];
  notes: string;
  incidentCategory?: string;
  issueDescription?: string;
}

const checkoutSchema = z
  .object({
    bookingId: z.string().trim().min(1).max(100),
    conditionState: z.enum(CONDITION_STATES),
    notes: z
      .string()
      .trim()
      .min(5, "Describe the room condition in at least 5 characters.")
      .max(1000, "Keep the condition note under 1,000 characters."),
    incidentCategory: z.string().trim().optional().default(""),
    issueDescription: z
      .string()
      .trim()
      .max(1500, "Keep the issue description under 1,500 characters.")
      .optional()
      .default(""),
  })
  .superRefine((value, context) => {
    if (value.conditionState !== "issue_found") {
      return;
    }

    if (
      !INCIDENT_CATEGORIES.includes(
        value.incidentCategory as IncidentCategory,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["incidentCategory"],
        message: "Choose a valid issue category.",
      });
    }

    if (value.issueDescription.length < 10) {
      context.addIssue({
        code: "custom",
        path: ["issueDescription"],
        message: "Describe the issue in at least 10 characters.",
      });
    }
  });

function fieldErrors(error: z.ZodError): CheckoutFieldErrors {
  const result: CheckoutFieldErrors = {};

  for (const issue of error.issues) {
    const field = issue.path[0];
    if (
      (field === "notes" ||
        field === "incidentCategory" ||
        field === "issueDescription") &&
      !result[field]
    ) {
      result[field] = issue.message;
    }
  }

  return result;
}

function loadBooking(
  db: RoomRelayDatabase,
  bookingId: string,
): CheckoutBookingRow | null {
  const row = db
    .prepare(
      `SELECT
         b.id, b.room_id, b.requester_id, b.status, b.start_at, b.end_at,
         r.code AS room_code, r.name AS room_name
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       WHERE b.id = ?`,
    )
    .get(bookingId) as CheckoutBookingRow | undefined;

  return row ?? null;
}

/**
 * Requester check-out. The after-use report, optional incident, booking status,
 * timestamps, and audit events all commit in one immediate transaction.
 */
export function checkOutBooking(
  db: RoomRelayDatabase,
  actor: UserProfile,
  input: CheckoutInput,
): CheckoutResult {
  const parsed = checkoutSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      kind: "validation",
      message:
        parsed.error.issues[0]?.message ?? "Check the check-out details.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const correlationId = randomUUID();

  try {
    const execute = db.transaction((): CheckoutResult => {
      const freshActor = getProfileById(db, actor.id);

      if (!freshActor) {
        return {
          ok: false,
          kind: "forbidden",
          message: "Your account cannot complete this check-out.",
        };
      }

      const booking = loadBooking(db, data.bookingId);

      if (!booking || booking.requester_id !== freshActor.id) {
        return {
          ok: false,
          kind: "not_found",
          message: "That booking could not be found.",
        };
      }

      if (booking.status !== "checked_in") {
        return {
          ok: false,
          kind: "not_checkable",
          message:
            booking.status === "completed" || booking.status === "incident"
              ? "This booking has already been checked out."
              : "This booking is not checked in and cannot be checked out.",
          currentStatus: booking.status,
        };
      }

      const existingReport = db
        .prepare(
          "SELECT id FROM condition_reports WHERE booking_id = ? AND stage = 'after'",
        )
        .get(booking.id);

      if (existingReport) {
        return {
          ok: false,
          kind: "not_checkable",
          message: "A check-out condition report already exists for this booking.",
          currentStatus: booking.status,
        };
      }

      const nowIso = new Date().toISOString();
      const reportId = `condition_${randomUUID()}`;
      const issueFound = data.conditionState === "issue_found";

      db.prepare(
        `INSERT INTO condition_reports (
           id, booking_id, stage, condition_state, notes, submitted_by, created_at
         ) VALUES (?, ?, 'after', ?, ?, ?, ?)`,
      ).run(
        reportId,
        booking.id,
        data.conditionState,
        data.notes,
        freshActor.id,
        nowIso,
      );

      db.prepare(
        `INSERT INTO audit_events (
           id, actor_id, action, entity_type, entity_id, occurred_at,
           summary, correlation_id, metadata_json
         ) VALUES (?, ?, 'condition.after_submitted', 'condition_report', ?, ?,
                   ?, ?, ?)`,
      ).run(
        `audit_${randomUUID()}`,
        freshActor.id,
        reportId,
        nowIso,
        `${freshActor.displayName} submitted a check-out condition report for ${booking.room_name}.`,
        `checkout-condition:${correlationId}`,
        JSON.stringify({
          bookingId: booking.id,
          conditionState: data.conditionState,
        }),
      );

      let incidentId: string | null = null;
      const nextStatus: "completed" | "incident" = issueFound
        ? "incident"
        : "completed";

      if (issueFound) {
        incidentId = `incident_${randomUUID()}`;
        db.prepare(
          `INSERT INTO incidents (
             id, booking_id, category, description, status, reporter_id,
             reviewer_id, resolution_note, created_at, updated_at,
             manager_reviewed_by, manager_reviewed_at, manager_review_note,
             resolved_at
           ) VALUES (?, ?, ?, ?, 'open', ?, NULL, NULL, ?, ?, NULL, NULL, NULL, NULL)`,
        ).run(
          incidentId,
          booking.id,
          data.incidentCategory,
          data.issueDescription,
          freshActor.id,
          nowIso,
          nowIso,
        );

        db.prepare(
          `INSERT INTO audit_events (
             id, actor_id, action, entity_type, entity_id, occurred_at,
             summary, correlation_id, metadata_json
           ) VALUES (?, ?, 'incident.reported', 'incident', ?, ?, ?, ?, ?)`,
        ).run(
          `audit_${randomUUID()}`,
          freshActor.id,
          incidentId,
          nowIso,
          `${freshActor.displayName} reported a ${data.incidentCategory} issue for ${booking.room_name}.`,
          `checkout-incident:${correlationId}`,
          JSON.stringify({
            bookingId: booking.id,
            category: data.incidentCategory,
          }),
        );
      }

      const update = db
        .prepare(
          `UPDATE bookings
           SET status = @status,
               checked_out_at = @checked_out_at,
               closed_at = @closed_at,
               closure_reason = @closure_reason,
               updated_at = @updated_at
           WHERE id = @id
             AND requester_id = @requester_id
             AND status = 'checked_in'`,
        )
        .run({
          id: booking.id,
          requester_id: freshActor.id,
          status: nextStatus,
          checked_out_at: nowIso,
          closed_at: issueFound ? null : nowIso,
          closure_reason: issueFound ? "issue_found" : "left_as_found",
          updated_at: nowIso,
        });

      if (update.changes !== 1) {
        return {
          ok: false,
          kind: "not_checkable",
          message: "This booking was already updated. Refresh to see its state.",
          currentStatus: booking.status,
        };
      }

      if (!issueFound) {
        db.prepare(
          `INSERT INTO audit_events (
             id, actor_id, action, entity_type, entity_id, occurred_at,
             summary, correlation_id, metadata_json
           ) VALUES (?, ?, 'booking.completed', 'booking', ?, ?, ?, ?, ?)`,
        ).run(
          `audit_${randomUUID()}`,
          freshActor.id,
          booking.id,
          nowIso,
          `${freshActor.displayName} completed the booking for ${booking.room_name}.`,
          `booking-completed:${correlationId}`,
          JSON.stringify({
            closureReason: "left_as_found",
            conditionReportId: reportId,
          }),
        );
      }

      if (issueFound && incidentId) {
        const managerId = activeRoomManagerId(db, booking.room_id);

        if (managerId) {
          createNotification(db, {
            recipientId: managerId,
            kind: "incident_update",
            title: `Issue reported: ${booking.room_name}`,
            body: `${freshActor.displayName} checked out and reported a ${categoryLabel(
              data.incidentCategory ?? "other",
            ).toLowerCase()} issue. It needs your review.`,
            linkPath: `/app/incidents/${incidentId}`,
            bookingId: booking.id,
            createdAt: nowIso,
          });
        }
      }

      // Leaving early frees the rest of the slot for anyone waitlisted.
      if (Date.parse(booking.end_at) > Date.parse(nowIso)) {
        promoteWaitlist(db, {
          roomId: booking.room_id,
          freedStartAt: nowIso,
          freedEndAt: booking.end_at,
          nowIso,
          correlationId,
          cause: "the previous booking checked out early",
        });
      }

      return {
        ok: true,
        kind: "checked_out",
        receipt: {
          bookingId: booking.id,
          status: nextStatus,
          checkedOutAt: nowIso,
          conditionReportId: reportId,
          incidentId,
        },
      };
    });

    return execute.immediate();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    if (
      message.includes("INVALID_BOOKING_TRANSITION") ||
      message.includes("CHECKOUT_REPORT_REQUIRED") ||
      message.includes("INCIDENT_REPORT_REQUIRED") ||
      message.includes("CHECKOUT_TIME_REQUIRED") ||
      message.includes("CLOSE_TIME_REQUIRED") ||
      message.includes("UNIQUE constraint")
    ) {
      return {
        ok: false,
        kind: "not_checkable",
        message:
          "The booking could not be checked out in its current state. Refresh and try again.",
        currentStatus: "checked_in",
      };
    }

    console.error("Check-out failed:", correlationId, message);

    return {
      ok: false,
      kind: "service_error",
      message: "The check-out could not be saved. Please try again.",
      correlationId,
    };
  }
}

export function categoryLabel(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1).replaceAll("_", " ");
}
