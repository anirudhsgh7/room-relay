import type { UserProfile } from "@/lib/auth/service";
import { isActiveProfile } from "@/lib/authorization";
import type { RoomRelayDatabase } from "@/lib/db/client";
import type { BookingStatus } from "@/lib/domain";
import { getBlockingBookings } from "@/lib/rooms/availability";
import {
  getCurrentRequirementsForProfile,
  getOutstandingMandatoryRequirements,
} from "@/lib/rooms/queries";
import type { RoomHours, RoomPolicy, RoomRequirement } from "@/lib/rooms/types";
import {
  campusLocalDayRange,
  formatCampusDate,
  formatCampusTimeRange,
} from "@/lib/time/campus-time";

export const MANAGER_QUEUE_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
] as const;

export type ManagerQueueStatus = (typeof MANAGER_QUEUE_STATUSES)[number];

export interface ManagerQueueFilters {
  status: ManagerQueueStatus;
  roomCode: string;
  date: string;
  eligibility: "all" | "needs_review";
  conflict: "all" | "any";
  page: number;
}

export interface ParsedManagerFilters {
  filters: ManagerQueueFilters;
  error?: string;
}

export interface ManagerQueueCounts {
  pending: number;
  approved: number;
  rejected: number;
  cancelled: number;
}

export interface ManagerEligibilityWarning {
  requirementId: string;
  description: string;
}

export interface ManagerQueueItem {
  id: string;
  roomId: string;
  roomCode: string;
  roomName: string;
  building: string;
  location: string;
  capacity: number;
  managerId: string;
  requesterId: string;
  requesterName: string;
  purpose: string;
  groupName: string | null;
  expectedAttendance: number;
  startAt: string;
  endAt: string;
  status: BookingStatus;
  createdAt: string;
  decisionReason: string | null;
  decidedAt: string | null;
  decisionActorName: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  eligibilityOverrideReason: string | null;
  snapshotWarnings: ManagerEligibilityWarning[];
  outstandingRequirementCount: number;
  pendingOverlapCount: number;
  hasConfirmedConflict: boolean;
  dateLabel: string;
  timeLabel: string;
}

export interface ManagerQueueRoomOption {
  code: string;
  name: string;
}

export interface ManagerQueueResult {
  items: ManagerQueueItem[];
  counts: ManagerQueueCounts;
  rooms: ManagerQueueRoomOption[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ManagerRoomContext {
  status: string;
  requestsEnabled: boolean;
  capacity: number;
  facilities: string[];
  policySummary: string;
  policy: RoomPolicy;
  hours: RoomHours[];
}

export interface ManagerOverlapItem {
  id: string;
  requesterName: string;
  purpose: string;
  groupName: string | null;
  startAt: string;
  endAt: string;
  createdAt: string;
  dateLabel: string;
  timeLabel: string;
}

export interface ManagerHistoryItem {
  id: string;
  action: string;
  occurredAt: string;
  summary: string;
  actorName: string | null;
}

export interface ManagerRequestDetail extends ManagerQueueItem {
  room: ManagerRoomContext;
  requirements: RoomRequirement[];
  outstandingRequirements: RoomRequirement[];
  overlaps: ManagerOverlapItem[];
  historicalDecision: {
    reason: string | null;
    actorName: string | null;
    decidedAt: string | null;
  };
  history: ManagerHistoryItem[];
  requesterActive: boolean;
  startInFuture: boolean;
  canDecide: boolean;
}

export interface ManagerQueuePage {
  result: ManagerQueueResult;
  filters: ManagerQueueFilters;
  filterError?: string;
}

interface ManagerBookingRow {
  id: string;
  room_id: string;
  room_code: string;
  room_name: string;
  building: string;
  location: string;
  capacity: number;
  manager_id: string;
  requester_id: string;
  requester_name: string;
  requester_status: string;
  purpose: string;
  group_name: string | null;
  expected_attendance: number;
  start_at: string;
  end_at: string;
  status: BookingStatus;
  created_at: string;
  decision_reason: string | null;
  decided_at: string | null;
  decision_actor_name: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  eligibility_override_reason: string | null;
  eligibility_snapshot_json: string | null;
}

interface ManagerRoomRow {
  id: string;
  status: string;
  capacity: number;
  facilities: string;
  policy_summary: string;
  requests_enabled: number | null;
  slot_interval_minutes: number | null;
  minimum_notice_minutes: number | null;
  maximum_duration_minutes: number | null;
  buffer_minutes: number | null;
}

interface ManagerHoursRow {
  weekday: number;
  opens_at: string;
  closes_at: string;
  effective_from: string;
  effective_until: string | null;
}

const PAGE_SIZE = 25;
const MAX_SCOPED_ROWS = 500;

function parseStatus(value: string | string[] | undefined): ManagerQueueStatus {
  const candidate = Array.isArray(value) ? value[0] : value;
  return MANAGER_QUEUE_STATUSES.includes(candidate as ManagerQueueStatus)
    ? (candidate as ManagerQueueStatus)
    : "pending";
}

function parsePage(value: string | string[] | undefined): number {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = Number(candidate);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function parseManagerQueueFilters(
  raw: Record<string, string | string[] | undefined>,
): ParsedManagerFilters {
  let error: string | undefined;
  const rawDate = Array.isArray(raw.date) ? raw.date[0] : raw.date;
  const date = rawDate?.trim() ?? "";

  if (date) {
    try {
      campusLocalDayRange(date);
    } catch {
      error = "Enter a valid date for the queue filter.";
    }
  }

  const roomCode = (Array.isArray(raw.room) ? raw.room[0] : raw.room)?.trim() ?? "";
  const eligibility =
    (Array.isArray(raw.eligibility) ? raw.eligibility[0] : raw.eligibility) ===
    "needs_review"
      ? "needs_review"
      : "all";
  const conflict =
    (Array.isArray(raw.conflict) ? raw.conflict[0] : raw.conflict) === "any"
      ? "any"
      : "all";

  return {
    error,
    filters: {
      status: parseStatus(raw.status),
      roomCode: roomCode.length <= 40 ? roomCode : "",
      date: error ? "" : date,
      eligibility,
      conflict,
      page: parsePage(raw.page),
    },
  };
}

function canUseManagerQueue(actor: UserProfile): boolean {
  return (
    isActiveProfile(actor) &&
    (actor.role === "manager" || actor.role === "admin")
  );
}

function scopeFor(actor: UserProfile): { sql: string; parameters: string[] } {
  if (actor.role === "admin") {
    return { sql: "1 = 1", parameters: [] };
  }

  return { sql: "r.manager_id = ?", parameters: [actor.id] };
}

const MANAGER_SELECT = `
  SELECT
    b.id, b.room_id, b.requester_id, b.purpose, b.group_name,
    b.expected_attendance, b.start_at, b.end_at, b.status, b.created_at,
    b.decision_reason, b.decided_at, b.cancelled_at, b.cancellation_reason,
    b.eligibility_override_reason, b.eligibility_snapshot_json,
    r.code AS room_code, r.name AS room_name, r.building, r.location,
    r.capacity, r.manager_id,
    requester.display_name AS requester_name,
    requester.status AS requester_status,
    decision_actor.display_name AS decision_actor_name
  FROM bookings b
  JOIN rooms r ON r.id = b.room_id
  JOIN profiles requester ON requester.id = b.requester_id
  LEFT JOIN profiles decision_actor ON decision_actor.id = b.decided_by
`;

function parseSnapshotWarnings(value: string | null): ManagerEligibilityWarning[] {
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

function pendingOverlapCount(
  db: RoomRelayDatabase,
  booking: { id: string; room_id: string; start_at: string; end_at: string },
): number {
  const row = db
    .prepare(
      `SELECT count(*) AS count
       FROM bookings other
       WHERE other.room_id = ?
         AND other.id <> ?
         AND other.status = 'pending'
         AND julianday(other.start_at) < julianday(?)
         AND julianday(other.end_at) > julianday(?)`,
    )
    .get(booking.room_id, booking.id, booking.end_at, booking.start_at) as {
    count: number;
  };

  return row.count;
}

function roomPolicy(row: ManagerRoomRow): RoomPolicy {
  return {
    requestsEnabled: row.requests_enabled === 1,
    slotIntervalMinutes: row.slot_interval_minutes ?? 30,
    minimumNoticeMinutes: row.minimum_notice_minutes ?? 30,
    maximumDurationMinutes: row.maximum_duration_minutes ?? 240,
    bufferMinutes: row.buffer_minutes ?? 0,
  };
}

function hydrateQueueItem(
  db: RoomRelayDatabase,
  row: ManagerBookingRow,
  policies: Map<string, RoomPolicy>,
): ManagerQueueItem {
  const policy = policies.get(row.room_id);
  const outstanding = getOutstandingMandatoryRequirements(
    db,
    row.room_id,
    row.requester_id,
  );
  const blockers = getBlockingBookings(
    db,
    row.room_id,
    row.start_at,
    row.end_at,
    policy?.bufferMinutes ?? 0,
  ).filter((blocker) => blocker.id !== row.id);
  const overlapCount =
    row.status === "pending"
      ? pendingOverlapCount(db, {
          id: row.id,
          room_id: row.room_id,
          start_at: row.start_at,
          end_at: row.end_at,
        })
      : 0;

  return {
    id: row.id,
    roomId: row.room_id,
    roomCode: row.room_code,
    roomName: row.room_name,
    building: row.building,
    location: row.location,
    capacity: row.capacity,
    managerId: row.manager_id,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    purpose: row.purpose,
    groupName: row.group_name,
    expectedAttendance: row.expected_attendance,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
    createdAt: row.created_at,
    decisionReason: row.decision_reason,
    decidedAt: row.decided_at,
    decisionActorName: row.decision_actor_name,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    eligibilityOverrideReason: row.eligibility_override_reason,
    snapshotWarnings: parseSnapshotWarnings(row.eligibility_snapshot_json),
    outstandingRequirementCount: outstanding.length,
    pendingOverlapCount: overlapCount,
    hasConfirmedConflict: blockers.length > 0,
    dateLabel: formatCampusDate(row.start_at),
    timeLabel: formatCampusTimeRange(row.start_at, row.end_at),
  };
}

function loadPolicies(
  db: RoomRelayDatabase,
  roomIds: string[],
): Map<string, RoomPolicy> {
  if (roomIds.length === 0) {
    return new Map();
  }

  const placeholders = roomIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT
         room_id, requests_enabled, slot_interval_minutes,
         minimum_notice_minutes, maximum_duration_minutes, buffer_minutes
       FROM room_booking_policies
       WHERE room_id IN (${placeholders})`,
    )
    .all(...roomIds) as Array<{
    room_id: string;
    requests_enabled: number;
    slot_interval_minutes: number;
    minimum_notice_minutes: number;
    maximum_duration_minutes: number;
    buffer_minutes: number;
  }>;

  return new Map(
    rows.map((row) => [
      row.room_id,
      {
        requestsEnabled: row.requests_enabled === 1,
        slotIntervalMinutes: row.slot_interval_minutes,
        minimumNoticeMinutes: row.minimum_notice_minutes,
        maximumDurationMinutes: row.maximum_duration_minutes,
        bufferMinutes: row.buffer_minutes,
      },
    ]),
  );
}

function scopedRooms(
  db: RoomRelayDatabase,
  actor: UserProfile,
): ManagerQueueRoomOption[] {
  const scope = scopeFor(actor);
  return db
    .prepare(
      `SELECT DISTINCT r.code, r.name
       FROM rooms r
       WHERE ${scope.sql}
       ORDER BY r.name`,
    )
    .all(...scope.parameters) as ManagerQueueRoomOption[];
}

export function listManagerQueue(
  db: RoomRelayDatabase,
  actor: UserProfile,
  filters: ManagerQueueFilters,
): ManagerQueueResult {
  const emptyCounts: ManagerQueueCounts = {
    pending: 0,
    approved: 0,
    rejected: 0,
    cancelled: 0,
  };

  if (!canUseManagerQueue(actor)) {
    return {
      items: [],
      counts: emptyCounts,
      rooms: [],
      total: 0,
      page: 1,
      pageSize: PAGE_SIZE,
    };
  }

  const scope = scopeFor(actor);
  const dateRange = filters.date
    ? campusLocalDayRange(filters.date)
    : null;
  const commonConditions = [scope.sql];
  const commonParameters = [...scope.parameters];

  if (filters.roomCode) {
    commonConditions.push("r.code = ? COLLATE NOCASE");
    commonParameters.push(filters.roomCode);
  }
  if (dateRange) {
    commonConditions.push("b.start_at >= ? AND b.start_at < ?");
    commonParameters.push(dateRange.startUtc, dateRange.endUtc);
  }

  const countRows = db
    .prepare(
      `SELECT b.status, count(*) AS count
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       WHERE ${commonConditions.join(" AND ")}
       GROUP BY b.status`,
    )
    .all(...commonParameters) as Array<{ status: BookingStatus; count: number }>;

  const counts = { ...emptyCounts };
  for (const row of countRows) {
    if (row.status in counts) {
      counts[row.status as ManagerQueueStatus] = row.count;
    }
  }

  const rows = db
    .prepare(
      `${MANAGER_SELECT}
       WHERE ${commonConditions.join(" AND ")}
         AND b.status = ?
       ORDER BY b.created_at ASC, b.start_at ASC, b.id ASC
       LIMIT ${MAX_SCOPED_ROWS}`,
    )
    .all(...commonParameters, filters.status) as ManagerBookingRow[];

  const policies = loadPolicies(
    db,
    [...new Set(rows.map((row) => row.room_id))],
  );
  let items = rows.map((row) => hydrateQueueItem(db, row, policies));

  if (filters.status === "pending") {
    items.sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.startAt.localeCompare(right.startAt) ||
        left.id.localeCompare(right.id),
    );
  } else {
    items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  if (filters.eligibility === "needs_review") {
    items = items.filter((item) => item.outstandingRequirementCount > 0);
  }

  if (filters.conflict === "any") {
    items = items.filter(
      (item) => item.hasConfirmedConflict || item.pendingOverlapCount > 0,
    );
  }

  const total = items.length;
  const page = Math.min(
    filters.page,
    Math.max(1, Math.ceil(total / PAGE_SIZE) || 1),
  );
  const start = (page - 1) * PAGE_SIZE;

  return {
    items: items.slice(start, start + PAGE_SIZE),
    counts,
    rooms: scopedRooms(db, actor),
    total,
    page,
    pageSize: PAGE_SIZE,
  };
}

export function getManagerRequest(
  db: RoomRelayDatabase,
  actor: UserProfile,
  bookingId: string,
): ManagerRequestDetail | null {
  if (!canUseManagerQueue(actor)) {
    return null;
  }

  const scope = scopeFor(actor);
  const row = db
    .prepare(
      `${MANAGER_SELECT}
       WHERE b.id = ?
         AND ${scope.sql}`,
    )
    .get(bookingId, ...scope.parameters) as ManagerBookingRow | undefined;

  if (!row) {
    return null;
  }

  const roomRow = db
    .prepare(
      `SELECT
         r.id, r.status, r.capacity, r.facilities, r.policy_summary,
         policy.requests_enabled, policy.slot_interval_minutes,
         policy.minimum_notice_minutes, policy.maximum_duration_minutes,
         policy.buffer_minutes
       FROM rooms r
       LEFT JOIN room_booking_policies policy ON policy.room_id = r.id
       WHERE r.id = ?`,
    )
    .get(row.room_id) as ManagerRoomRow | undefined;

  const hours = (
    db
      .prepare(
        `SELECT weekday, opens_at, closes_at, effective_from, effective_until
         FROM availability_rules
         WHERE room_id = ? AND active = 1
         ORDER BY weekday, opens_at`,
      )
      .all(row.room_id) as ManagerHoursRow[]
  ).map<RoomHours>((hour) => ({
    weekday: hour.weekday,
    opensAt: hour.opens_at,
    closesAt: hour.closes_at,
    effectiveFrom: hour.effective_from,
    effectiveUntil: hour.effective_until,
  }));

  const policy = roomRow ? roomPolicy(roomRow) : null;
  const currentRequirements = getCurrentRequirementsForProfile(
    db,
    row.room_id,
    row.requester_id,
  );
  const outstandingRequirements = currentRequirements.filter(
    (requirement) =>
      requirement.required && requirement.verification !== "verified",
  );
  const overlaps = db
    .prepare(
      `SELECT
         other.id, other.purpose, other.group_name, other.start_at,
         other.end_at, other.created_at,
         requester.display_name AS requester_name
       FROM bookings other
       JOIN profiles requester ON requester.id = other.requester_id
       WHERE other.room_id = ?
         AND other.id <> ?
         AND other.status = 'pending'
         AND julianday(other.start_at) < julianday(?)
         AND julianday(other.end_at) > julianday(?)
       ORDER BY other.created_at ASC, other.id ASC`,
    )
    .all(row.room_id, row.id, row.end_at, row.start_at) as Array<{
    id: string;
    purpose: string;
    group_name: string | null;
    start_at: string;
    end_at: string;
    created_at: string;
    requester_name: string;
  }>;

  const history = db
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
    .all(row.id) as Array<{
    id: string;
    action: string;
    occurred_at: string;
    summary: string;
    actor_name: string | null;
  }>;

  const policies = loadPolicies(db, [row.room_id]);
  const item = hydrateQueueItem(db, row, policies);

  return {
    ...item,
    room: {
      status: roomRow?.status ?? "inactive",
      requestsEnabled: policy?.requestsEnabled ?? false,
      capacity: roomRow?.capacity ?? row.capacity,
      facilities: roomRow ? parseFacilities(roomRow.facilities) : [],
      policySummary: roomRow?.policy_summary ?? "",
      policy: policy ?? {
        requestsEnabled: false,
        slotIntervalMinutes: 30,
        minimumNoticeMinutes: 30,
        maximumDurationMinutes: 240,
        bufferMinutes: 0,
      },
      hours,
    },
    requirements: roomRow ? currentRequirements : [],
    outstandingRequirements,
    overlaps: overlaps.map((overlap) => ({
      id: overlap.id,
      requesterName: overlap.requester_name,
      purpose: overlap.purpose,
      groupName: overlap.group_name,
      startAt: overlap.start_at,
      endAt: overlap.end_at,
      createdAt: overlap.created_at,
      dateLabel: formatCampusDate(overlap.start_at),
      timeLabel: formatCampusTimeRange(overlap.start_at, overlap.end_at),
    })),
    historicalDecision: {
      reason: row.decision_reason,
      actorName: row.decision_actor_name,
      decidedAt: row.decided_at,
    },
    history: history.map((event) => ({
      id: event.id,
      action: event.action,
      occurredAt: event.occurred_at,
      summary: event.summary,
      actorName: event.actor_name,
    })),
    requesterActive: row.requester_status === "active",
    startInFuture: Date.parse(row.start_at) > Date.now(),
    canDecide: row.status === "pending",
  };
}

function parseFacilities(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}
