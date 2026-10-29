import type { RoomRelayDatabase } from "@/lib/db/client";
import { getOutstandingMandatoryRequirements } from "@/lib/rooms/queries";
import {
  ALLOCATION_RULE_COPY,
  FAIR_SHARE_LOOKBACK_DAYS,
  formatMinutes,
  POLICY_SELECT_COLUMNS,
  policyFromColumns,
  type AllocationRule,
  type PolicyColumns,
} from "@/lib/rooms/policy";
import type { RoomPolicy } from "@/lib/rooms/types";

export type CompetingStatus = "pending" | "waitlisted";

/** A request that competes for a room/time under the published rule. */
export interface AllocationCandidate {
  id: string;
  roomId: string;
  requesterId: string;
  requesterName: string;
  purpose: string;
  groupName: string | null;
  expectedAttendance: number;
  startAt: string;
  endAt: string;
  createdAt: string;
  status: CompetingStatus;
  meetsRequirements: boolean;
  /** Confirmed minutes in this room since the fair-share lookback began. */
  bookedMinutes: number;
}

export interface RankedCompetitor extends AllocationCandidate {
  /** Plain-language reason this request sorts ahead of or behind the target. */
  comparison: string;
}

export interface AllocationStanding {
  rule: AllocationRule;
  ruleLabel: string;
  /** 1 = first in line among the requests that compete with this one. */
  position: number;
  /** The target plus every request that competes with it. */
  total: number;
  ahead: RankedCompetitor[];
  behind: RankedCompetitor[];
}

interface CandidateRow {
  id: string;
  room_id: string;
  requester_id: string;
  requester_name: string;
  purpose: string;
  group_name: string | null;
  expected_attendance: number;
  start_at: string;
  end_at: string;
  created_at: string;
  status: string;
}

const CANDIDATE_SELECT = `
  SELECT
    b.id, b.room_id, b.requester_id, b.purpose, b.group_name,
    b.expected_attendance, b.start_at, b.end_at, b.created_at, b.status,
    requester.display_name AS requester_name
  FROM bookings b
  JOIN profiles requester ON requester.id = b.requester_id
`;

export async function loadRoomPolicy(
  db: RoomRelayDatabase,
  roomId: string,
): Promise<RoomPolicy | null> {
  const row = (await db
    .prepare(
      `SELECT ${POLICY_SELECT_COLUMNS}
       FROM room_booking_policies policy
       WHERE policy.room_id = ?`,
    )
    .get(roomId)) as PolicyColumns | undefined;

  return row ? policyFromColumns(row) : null;
}

export async function bookedMinutesForFairShare(
  db: RoomRelayDatabase,
  requesterId: string,
  roomId: string,
  now = new Date(),
): Promise<number> {
  const since = new Date(
    now.getTime() - FAIR_SHARE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const row = (await db
    .prepare(
      `SELECT COALESCE(
         SUM(EXTRACT(EPOCH FROM (end_at - start_at)) / 60)::integer,
         0
       ) AS minutes
       FROM bookings
       WHERE requester_id = ?
         AND room_id = ?
         AND status IN ('approved', 'checked_in', 'completed', 'incident')
         AND end_at > ?`,
    )
    .get([requesterId, roomId, since])) as { minutes: number };

  return row.minutes;
}

async function toCandidate(
  db: RoomRelayDatabase,
  row: CandidateRow,
  now: Date,
): Promise<AllocationCandidate> {
  return {
    id: row.id,
    roomId: row.room_id,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    purpose: row.purpose,
    groupName: row.group_name,
    expectedAttendance: row.expected_attendance,
    startAt: row.start_at,
    endAt: row.end_at,
    createdAt: row.created_at,
    status: row.status === "waitlisted" ? "waitlisted" : "pending",
    meetsRequirements:
      (await getOutstandingMandatoryRequirements(db, row.room_id, row.requester_id))
        .length === 0,
    bookedMinutes: await bookedMinutesForFairShare(
      db,
      row.requester_id,
      row.room_id,
      now,
    ),
  };
}

export async function loadCandidate(
  db: RoomRelayDatabase,
  bookingId: string,
  now = new Date(),
): Promise<AllocationCandidate | null> {
  const row = (await db
    .prepare(`${CANDIDATE_SELECT} WHERE b.id = ?`)
    .get(bookingId)) as CandidateRow | undefined;

  return row ? toCandidate(db, row, now) : null;
}

/**
 * Requests in `statuses` that conflict with [startAt, endAt) in the same room
 * under the shared buffer-aware conflict rule. The target itself is excluded.
 */
export async function loadConflictingCandidates(
  db: RoomRelayDatabase,
  input: {
    roomId: string;
    excludeBookingId: string | null;
    startAt: string;
    endAt: string;
    bufferMinutes: number;
    statuses: CompetingStatus[];
  },
  now = new Date(),
): Promise<AllocationCandidate[]> {
  const allowed: CompetingStatus[] = ["pending", "waitlisted"];
  const statusList = input.statuses
    .filter((status) => allowed.includes(status))
    .map((status) => `'${status}'`)
    .join(", ");

  if (!statusList) {
    return [];
  }

  const rows = (await db
    .prepare(
      `${CANDIDATE_SELECT}
       WHERE b.room_id = @room_id
         AND (@exclude::text IS NULL OR b.id <> @exclude::text)
         AND b.status IN (${statusList})
         AND b.start_at < @end_at::timestamptz + (@buffer * interval '1 minute')
         AND b.end_at + (@buffer * interval '1 minute') > @start_at::timestamptz
       ORDER BY b.created_at, b.id
       LIMIT 200`,
    )
    .all({
      room_id: input.roomId,
      exclude: input.excludeBookingId,
      start_at: input.startAt,
      end_at: input.endAt,
      buffer: input.bufferMinutes,
    })) as CandidateRow[];

  return Promise.all(rows.map((row) => toCandidate(db, row, now)));
}

/**
 * The published ordering. Negative means `left` is allocated before `right`.
 * Every rule first prefers requests that already meet the room requirements,
 * and every rule ends with submission time and then a stable id tie-break.
 */
export function compareCandidates(
  rule: AllocationRule,
  left: AllocationCandidate,
  right: AllocationCandidate,
): number {
  if (left.meetsRequirements !== right.meetsRequirements) {
    return left.meetsRequirements ? -1 : 1;
  }

  if (rule === "best_fit" && left.expectedAttendance !== right.expectedAttendance) {
    return right.expectedAttendance - left.expectedAttendance;
  }

  if (rule === "fair_share" && left.bookedMinutes !== right.bookedMinutes) {
    return left.bookedMinutes - right.bookedMinutes;
  }

  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

export function rankCandidates(
  rule: AllocationRule,
  candidates: AllocationCandidate[],
): AllocationCandidate[] {
  return [...candidates].sort((left, right) =>
    compareCandidates(rule, left, right),
  );
}

/** Why `winner` is ordered before `other`, in the rule's own terms. */
export function explainOrder(
  rule: AllocationRule,
  winner: AllocationCandidate,
  other: AllocationCandidate,
): string {
  if (winner.meetsRequirements !== other.meetsRequirements) {
    return "already meets the room requirements";
  }

  if (rule === "best_fit" && winner.expectedAttendance !== other.expectedAttendance) {
    return `larger group (${winner.expectedAttendance} vs ${other.expectedAttendance} people)`;
  }

  if (rule === "fair_share" && winner.bookedMinutes !== other.bookedMinutes) {
    return `fewer recent hours in this room (${formatMinutes(
      winner.bookedMinutes,
    )} vs ${formatMinutes(other.bookedMinutes)})`;
  }

  return winner.createdAt === other.createdAt
    ? "same submission time; ordered by reference"
    : "submitted earlier";
}

/**
 * Where a request stands against the requests that compete with it. Only
 * requests that directly conflict with the target are counted, so the position
 * reflects the people who could actually take this slot.
 */
export async function getAllocationStanding(
  db: RoomRelayDatabase,
  bookingId: string,
  statuses: CompetingStatus[],
  now = new Date(),
): Promise<AllocationStanding | null> {
  const target = await loadCandidate(db, bookingId, now);

  if (!target) {
    return null;
  }

  const policy = await loadRoomPolicy(db, target.roomId);

  if (!policy) {
    return null;
  }

  const competitors = await loadConflictingCandidates(
    db,
    {
      roomId: target.roomId,
      excludeBookingId: target.id,
      startAt: target.startAt,
      endAt: target.endAt,
      bufferMinutes: policy.bufferMinutes,
      statuses,
    },
    now,
  );
  const rule = policy.allocationRule;
  const ahead: RankedCompetitor[] = [];
  const behind: RankedCompetitor[] = [];

  for (const competitor of rankCandidates(rule, competitors)) {
    if (compareCandidates(rule, competitor, target) < 0) {
      ahead.push({
        ...competitor,
        comparison: explainOrder(rule, competitor, target),
      });
    } else {
      behind.push({
        ...competitor,
        comparison: explainOrder(rule, target, competitor),
      });
    }
  }

  return {
    rule,
    ruleLabel: ALLOCATION_RULE_COPY[rule].label,
    position: ahead.length + 1,
    total: competitors.length + 1,
    ahead,
    behind,
  };
}
