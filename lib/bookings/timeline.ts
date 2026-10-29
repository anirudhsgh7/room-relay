import type { UserProfile } from "@/lib/auth/service";
import { isActiveProfile } from "@/lib/authorization";
import type { RoomRelayDatabase } from "@/lib/db/client";
import { ACCESS_REASON_MESSAGES } from "@/lib/access/types";
import {
  INCIDENT_CATEGORY_LABELS,
  type IncidentCategory,
} from "@/lib/incidents/constants";

export type TimelineEntryKind =
  | "request"
  | "decision"
  | "access"
  | "condition"
  | "incident"
  | "completion";

export interface TimelineEntry {
  id: string;
  kind: TimelineEntryKind;
  occurredAt: string;
  title: string;
  description: string;
  actorName: string | null;
}

export interface BookingTimeline {
  bookingId: string;
  roomName: string;
  entries: TimelineEntry[];
}

interface BookingScopeRow {
  id: string;
  room_name: string;
  requester_id: string;
  manager_id: string;
}

function actionTitle(action: string): string | null {
  switch (action) {
    case "booking.submitted":
      return "Request sent";
    case "booking.waitlist_joined":
      return "Joined the waitlist";
    case "booking.waitlisted":
      return "Moved to the waitlist";
    case "booking.promoted":
      return "Back in review from the waitlist";
    case "booking.approved":
      return "Approved";
    case "booking.rejected":
      return "Not approved";
    case "booking.cancelled":
      return "Cancelled";
    case "booking.completed":
      return "Completed";
    default:
      return null;
  }
}

function actionKind(action: string): TimelineEntryKind {
  switch (action) {
    case "booking.approved":
    case "booking.rejected":
    case "booking.cancelled":
    case "booking.waitlisted":
    case "booking.promoted":
      return "decision";
    case "booking.completed":
      return "completion";
    default:
      return "request";
  }
}

/**
 * Booking-scoped timeline assembled from append-only/auditable sources.
 * Returns null when the actor cannot read the booking.
 */
export function getBookingTimeline(
  db: RoomRelayDatabase,
  actor: UserProfile,
  bookingId: string,
): BookingTimeline | null {
  if (!isActiveProfile(actor)) {
    return null;
  }

  const booking = db
    .prepare(
      `SELECT
         b.id, b.requester_id, r.name AS room_name, r.manager_id
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       WHERE b.id = ?`,
    )
    .get(bookingId) as BookingScopeRow | undefined;

  if (!booking) {
    return null;
  }

  const canRead =
    actor.role === "admin" ||
    booking.requester_id === actor.id ||
    (actor.role === "manager" && booking.manager_id === actor.id);

  if (!canRead) {
    return null;
  }

  const entries: TimelineEntry[] = [];

  const auditRows = db
    .prepare(
      `SELECT
         event.id, event.action, event.occurred_at, event.summary,
         actor.display_name AS actor_name
       FROM audit_events event
       LEFT JOIN profiles actor ON actor.id = event.actor_id
       WHERE event.entity_type = 'booking'
         AND event.entity_id = ?
       ORDER BY event.occurred_at ASC, event.id ASC`,
    )
    .all(bookingId) as Array<{
    id: string;
    action: string;
    occurred_at: string;
    summary: string;
    actor_name: string | null;
  }>;

  for (const event of auditRows) {
    if (
      event.action.startsWith("condition.") ||
      event.action.startsWith("access.")
    ) {
      continue;
    }

    const title = actionTitle(event.action);

    if (!title) {
      continue;
    }

    entries.push({
      id: `audit:${event.id}`,
      kind: actionKind(event.action),
      occurredAt: event.occurred_at,
      title,
      description: event.summary,
      actorName: event.actor_name,
    });
  }

  const accessRows = db
    .prepare(
      `SELECT
         event.id, event.result, event.reason_code, event.occurred_at,
         actor.display_name AS actor_name
       FROM access_events event
       LEFT JOIN profiles actor ON actor.id = event.actor_id
       WHERE event.booking_id = ?
       ORDER BY event.occurred_at ASC, event.id ASC`,
    )
    .all(bookingId) as Array<{
    id: string;
    result: "allowed" | "denied";
    reason_code: string;
    occurred_at: string;
    actor_name: string | null;
  }>;

  for (const event of accessRows) {
    entries.push({
      id: `access:${event.id}`,
      kind: "access",
      occurredAt: event.occurred_at,
      title:
        event.result === "allowed"
          ? "Simulated access allowed"
          : "Simulated access denied",
      description:
        ACCESS_REASON_MESSAGES[event.reason_code] ??
        `Access result: ${event.reason_code}`,
      actorName: event.actor_name,
    });
  }

  const conditionRows = db
    .prepare(
      `SELECT
         report.id, report.stage, report.condition_state, report.notes,
         report.created_at, submitter.display_name AS actor_name
       FROM condition_reports report
       JOIN profiles submitter ON submitter.id = report.submitted_by
       WHERE report.booking_id = ?
       ORDER BY report.created_at ASC, report.id ASC`,
    )
    .all(bookingId) as Array<{
    id: string;
    stage: "before" | "after";
    condition_state: "left_as_found" | "issue_found" | null;
    notes: string;
    created_at: string;
    actor_name: string;
  }>;

  for (const report of conditionRows) {
    entries.push({
      id: `condition:${report.id}`,
      kind: "condition",
      occurredAt: report.created_at,
      title:
        report.stage === "after"
          ? report.condition_state === "issue_found"
            ? "Check-out condition reported with an issue"
            : "Check-out condition reported"
          : "Arrival condition reported",
      description: report.notes,
      actorName: report.actor_name,
    });
  }

  const incidentRows = db
    .prepare(
      `SELECT
         incident.id, incident.category, incident.description,
         incident.status, incident.created_at, incident.manager_reviewed_at,
         incident.manager_review_note, incident.resolved_at,
         incident.resolution_note,
         reporter.display_name AS reporter_name,
         manager.display_name AS manager_name,
         admin.display_name AS admin_name
       FROM incidents incident
       JOIN profiles reporter ON reporter.id = incident.reporter_id
       LEFT JOIN profiles manager ON manager.id = incident.manager_reviewed_by
       LEFT JOIN profiles admin ON admin.id = incident.reviewer_id
       WHERE incident.booking_id = ?
       ORDER BY incident.created_at ASC, incident.id ASC`,
    )
    .all(bookingId) as Array<{
    id: string;
    category: IncidentCategory;
    description: string;
    status: "open" | "reviewing" | "resolved";
    created_at: string;
    manager_reviewed_at: string | null;
    manager_review_note: string | null;
    resolved_at: string | null;
    resolution_note: string | null;
    reporter_name: string;
    manager_name: string | null;
    admin_name: string | null;
  }>;

  for (const incident of incidentRows) {
    entries.push({
      id: `incident:${incident.id}:reported`,
      kind: "incident",
      occurredAt: incident.created_at,
      title: "Incident reported",
      description: `${INCIDENT_CATEGORY_LABELS[incident.category]}: ${incident.description}`,
      actorName: incident.reporter_name,
    });

    if (incident.manager_reviewed_at && incident.manager_review_note) {
      entries.push({
        id: `incident:${incident.id}:review`,
        kind: "incident",
        occurredAt: incident.manager_reviewed_at,
        title: "Manager review recorded",
        description: incident.manager_review_note,
        actorName: incident.manager_name,
      });
    }

    if (incident.resolved_at && incident.resolution_note) {
      entries.push({
        id: `incident:${incident.id}:resolved`,
        kind: "incident",
        occurredAt: incident.resolved_at,
        title: "Incident resolved",
        description: incident.resolution_note,
        actorName: incident.admin_name,
      });
    }
  }

  entries.sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.id.localeCompare(right.id),
  );

  return {
    bookingId: booking.id,
    roomName: booking.room_name,
    entries,
  };
}
