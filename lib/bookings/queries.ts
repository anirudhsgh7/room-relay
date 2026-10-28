import type { RoomRelayDatabase } from "@/lib/db/client";
import type { UserProfile } from "@/lib/auth/service";
import type { BookingStatus } from "@/lib/domain";
import type { EligibilityWarning } from "@/lib/bookings/types";

interface BookingRow {
  id: string;
  room_code: string;
  room_name: string;
  building: string;
  location: string;
  purpose: string;
  group_name: string | null;
  expected_attendance: number;
  start_at: string;
  end_at: string;
  status: BookingStatus;
  decision_reason: string | null;
  decided_at: string | null;
  decision_actor_name: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  eligibility_override_reason: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  closed_at: string | null;
  closure_reason: string | null;
  created_at: string;
  updated_at: string;
  eligibility_snapshot_json: string | null;
}

export interface MyBooking {
  id: string;
  roomCode: string;
  roomName: string;
  building: string;
  location: string;
  purpose: string;
  groupName: string | null;
  expectedAttendance: number;
  startAt: string;
  endAt: string;
  status: BookingStatus;
  decisionReason: string | null;
  decidedAt: string | null;
  decisionActorName: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  eligibilityOverrideReason: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  closedAt: string | null;
  closureReason: string | null;
  createdAt: string;
  updatedAt: string;
  canCancel: boolean;
  canCheckOut: boolean;
  eligibilityWarnings: EligibilityWarning[];
}

function eligibilityWarnings(value: string | null): EligibilityWarning[] {
  if (!value) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      if (
        typeof item !== "object" ||
        item === null ||
        !("requirementId" in item) ||
        !("description" in item) ||
        !("required" in item) ||
        !("status" in item)
      ) {
        return [];
      }

      const candidate = item as {
        requirementId: string;
        description: string;
        required: boolean;
        status: string;
      };

      if (!candidate.required || candidate.status === "verified") {
        return [];
      }

      return [
        {
          requirementId: candidate.requirementId,
          description: candidate.description,
        },
      ];
    });
  } catch {
    return [];
  }
}

function mapBooking(row: BookingRow): MyBooking {
  return {
    id: row.id,
    roomCode: row.room_code,
    roomName: row.room_name,
    building: row.building,
    location: row.location,
    purpose: row.purpose,
    groupName: row.group_name,
    expectedAttendance: row.expected_attendance,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
    decisionReason: row.decision_reason,
    decidedAt: row.decided_at,
    decisionActorName: row.decision_actor_name,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    eligibilityOverrideReason: row.eligibility_override_reason,
    checkedInAt: row.checked_in_at,
    checkedOutAt: row.checked_out_at,
    closedAt: row.closed_at,
    closureReason: row.closure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canCancel:
      row.status === "pending" ||
      (row.status === "approved" &&
        Date.parse(row.start_at) > Date.now()),
    canCheckOut: row.status === "checked_in",
    eligibilityWarnings: eligibilityWarnings(row.eligibility_snapshot_json),
  };
}

const BOOKING_SELECT = `
  SELECT
    b.id, b.purpose, b.group_name, b.expected_attendance, b.start_at,
    b.end_at, b.status, b.decision_reason, b.decided_at, b.cancelled_at,
    b.cancellation_reason, b.eligibility_override_reason, b.checked_in_at,
    b.checked_out_at, b.closed_at, b.closure_reason, b.created_at,
    b.updated_at, b.eligibility_snapshot_json,
    r.code AS room_code, r.name AS room_name, r.building, r.location,
    decision_actor.display_name AS decision_actor_name
  FROM bookings b
  JOIN rooms r ON r.id = b.room_id
  LEFT JOIN profiles decision_actor ON decision_actor.id = b.decided_by
`;

export function listMyBookings(
  db: RoomRelayDatabase,
  profile: UserProfile,
  limit = 50,
): MyBooking[] {
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `${BOOKING_SELECT}
       WHERE b.requester_id = ?
       ORDER BY
         CASE
           WHEN b.status IN ('pending', 'approved', 'checked_in')
            AND b.start_at >= ? THEN 0
           ELSE 1
         END,
         b.start_at ASC,
         b.updated_at DESC
       LIMIT ?`,
    )
    .all(profile.id, now, Math.min(Math.max(limit, 1), 100)) as BookingRow[];

  return rows.map(mapBooking);
}

export function getMyBooking(
  db: RoomRelayDatabase,
  profile: UserProfile,
  bookingId: string,
): MyBooking | null {
  const row = db
    .prepare(
      `${BOOKING_SELECT}
       WHERE b.id = ?
         AND b.requester_id = ?`,
    )
    .get(bookingId, profile.id) as BookingRow | undefined;

  return row ? mapBooking(row) : null;
}
