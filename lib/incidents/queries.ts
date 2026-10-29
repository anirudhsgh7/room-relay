import type { UserProfile } from "@/lib/auth/service";
import { isActiveProfile } from "@/lib/authorization";
import type { RoomRelayDatabase } from "@/lib/db/client";
import type { BookingStatus } from "@/lib/domain";
import {
  INCIDENT_CATEGORIES,
  INCIDENT_CATEGORY_LABELS,
  INCIDENT_STATUS_LABELS,
  type IncidentCategory,
  type IncidentStatus,
} from "@/lib/incidents/constants";
import {
  campusLocalDayRange,
  formatCampusDate,
  formatCampusTimeRange,
} from "@/lib/time/campus-time";

export interface IncidentQueueFilters {
  status: "active" | IncidentStatus | "all";
  roomCode: string;
  category: IncidentCategory | "";
  date: string;
  page: number;
}

export interface ParsedIncidentFilters {
  filters: IncidentQueueFilters;
  error?: string;
}

export interface IncidentQueueItem {
  id: string;
  bookingId: string;
  roomCode: string;
  roomName: string;
  building: string;
  requesterName: string;
  reporterName: string;
  category: IncidentCategory;
  categoryLabel: string;
  description: string;
  status: IncidentStatus;
  statusLabel: string;
  createdAt: string;
  createdDateLabel: string;
  bookingStatus: BookingStatus;
  bookingStartAt: string;
  bookingEndAt: string;
  bookingTimeLabel: string;
  managerReviewedByName: string | null;
  managerReviewedAt: string | null;
  managerReviewNote: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface IncidentQueueResult {
  items: IncidentQueueItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: {
    open: number;
    reviewing: number;
    resolved: number;
  };
  rooms: Array<{ code: string; name: string }>;
}

export interface BookingIncidentItem {
  id: string;
  status: IncidentStatus;
  statusLabel: string;
  category: IncidentCategory;
  categoryLabel: string;
  description: string;
  createdAt: string;
  resolutionNote: string | null;
}

export interface IncidentDetail extends IncidentQueueItem {
  purpose: string;
  groupName: string | null;
  conditionReport: {
    id: string;
    conditionState: "left_as_found" | "issue_found";
    notes: string;
    createdAt: string;
  } | null;
  canReview: boolean;
  canResolve: boolean;
}

interface IncidentRow {
  id: string;
  booking_id: string;
  category: IncidentCategory;
  description: string;
  status: IncidentStatus;
  created_at: string;
  manager_reviewed_at: string | null;
  manager_review_note: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  room_code: string;
  room_name: string;
  building: string;
  manager_id: string;
  requester_id: string;
  requester_name: string;
  reporter_name: string;
  manager_reviewed_by_name: string | null;
  reviewer_name: string | null;
  booking_status: BookingStatus;
  booking_start_at: string;
  booking_end_at: string;
  purpose: string;
  group_name: string | null;
}

const PAGE_SIZE = 25;

function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number(raw);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export function parseIncidentFilters(
  raw: Record<string, string | string[] | undefined>,
): ParsedIncidentFilters {
  let error: string | undefined;
  const rawDate = first(raw.date);
  const rawStatus = first(raw.status);
  const rawCategory = first(raw.category);
  const status: IncidentQueueFilters["status"] =
    rawStatus === "open" ||
    rawStatus === "reviewing" ||
    rawStatus === "resolved" ||
    rawStatus === "all"
      ? rawStatus
      : "active";
  const category = INCIDENT_CATEGORIES.includes(
    rawCategory as IncidentCategory,
  )
    ? (rawCategory as IncidentCategory)
    : "";

  if (rawDate) {
    try {
      campusLocalDayRange(rawDate);
    } catch {
      error = "Enter a valid date for the incident filter.";
    }
  }

  return {
    error,
    filters: {
      status,
      roomCode: first(raw.room).slice(0, 40),
      category,
      date: error ? "" : rawDate,
      page: parsePage(raw.page),
    },
  };
}

function scopeFor(actor: UserProfile): { sql: string; parameters: string[] } {
  if (actor.role === "admin") {
    return { sql: "1 = 1", parameters: [] };
  }

  return { sql: "room.manager_id = ?", parameters: [actor.id] };
}

const INCIDENT_SELECT = `
  SELECT
    incident.id, incident.booking_id, incident.category, incident.description,
    incident.status, incident.created_at, incident.manager_reviewed_at,
    incident.manager_review_note, incident.resolved_at, incident.resolution_note,
    room.code AS room_code, room.name AS room_name, room.building,
    room.manager_id,
    booking.requester_id, booking.status AS booking_status,
    booking.start_at AS booking_start_at, booking.end_at AS booking_end_at,
    booking.purpose, booking.group_name,
    requester.display_name AS requester_name,
    reporter.display_name AS reporter_name,
    manager_reviewer.display_name AS manager_reviewed_by_name,
    admin_reviewer.display_name AS reviewer_name
  FROM incidents incident
  JOIN bookings booking ON booking.id = incident.booking_id
  JOIN rooms room ON room.id = booking.room_id
  JOIN profiles requester ON requester.id = booking.requester_id
  JOIN profiles reporter ON reporter.id = incident.reporter_id
  LEFT JOIN profiles manager_reviewer ON manager_reviewer.id = incident.manager_reviewed_by
  LEFT JOIN profiles admin_reviewer ON admin_reviewer.id = incident.reviewer_id
`;

function mapIncident(row: IncidentRow): IncidentQueueItem {
  return {
    id: row.id,
    bookingId: row.booking_id,
    roomCode: row.room_code,
    roomName: row.room_name,
    building: row.building,
    requesterName: row.requester_name,
    reporterName: row.reporter_name,
    category: row.category,
    categoryLabel:
      INCIDENT_CATEGORY_LABELS[row.category] ?? "Other",
    description: row.description,
    status: row.status,
    statusLabel: INCIDENT_STATUS_LABELS[row.status],
    createdAt: row.created_at,
    createdDateLabel: formatCampusDate(row.created_at),
    bookingStatus: row.booking_status,
    bookingStartAt: row.booking_start_at,
    bookingEndAt: row.booking_end_at,
    bookingTimeLabel: formatCampusTimeRange(
      row.booking_start_at,
      row.booking_end_at,
    ),
    managerReviewedByName: row.manager_reviewed_by_name,
    managerReviewedAt: row.manager_reviewed_at,
    managerReviewNote: row.manager_review_note,
    resolvedByName: row.reviewer_name,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
  };
}

export async function listIncidents(
  db: RoomRelayDatabase,
  actor: UserProfile,
  filters: IncidentQueueFilters,
): Promise<IncidentQueueResult> {
  const empty = {
    items: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    counts: { open: 0, reviewing: 0, resolved: 0 },
    rooms: [],
  };

  if (
    !isActiveProfile(actor) ||
    (actor.role !== "manager" && actor.role !== "admin")
  ) {
    return empty;
  }

  const scope = scopeFor(actor);
  const conditions = [scope.sql];
  const parameters = [...scope.parameters];

  if (filters.status === "active") {
    conditions.push("incident.status IN ('open', 'reviewing')");
  } else if (filters.status !== "all") {
    conditions.push("incident.status = ?");
    parameters.push(filters.status);
  }

  if (filters.roomCode) {
    conditions.push("lower(room.code) = lower(?)");
    parameters.push(filters.roomCode);
  }

  if (filters.category) {
    conditions.push("incident.category = ?");
    parameters.push(filters.category);
  }

  if (filters.date) {
    const range = campusLocalDayRange(filters.date);
    conditions.push("incident.created_at >= ? AND incident.created_at < ?");
    parameters.push(range.startUtc, range.endUtc);
  }

  const where = conditions.join(" AND ");
  const countRows = (await db
    .prepare(
      `SELECT incident.status, count(*) AS count
       FROM incidents incident
       JOIN bookings booking ON booking.id = incident.booking_id
       JOIN rooms room ON room.id = booking.room_id
       WHERE ${scope.sql}
       GROUP BY incident.status`,
    )
    .all(scope.parameters)) as Array<{ status: IncidentStatus; count: number }>;

  const counts = { open: 0, reviewing: 0, resolved: 0 };
  for (const row of countRows) {
    counts[row.status] = row.count;
  }

  const countRow = (await db
    .prepare(
      `SELECT count(*) AS count
       FROM incidents incident
       JOIN bookings booking ON booking.id = incident.booking_id
       JOIN rooms room ON room.id = booking.room_id
       WHERE ${where}`,
    )
    .get(parameters)) as { count: number };

  const total = countRow.count;
  const page = Math.min(
    filters.page,
    Math.max(1, Math.ceil(total / PAGE_SIZE) || 1),
  );
  const offset = (page - 1) * PAGE_SIZE;

  const rows = (await db
    .prepare(
      `${INCIDENT_SELECT}
       WHERE ${where}
       ORDER BY incident.created_at ASC, incident.id ASC
       LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    )
    .all(parameters)) as IncidentRow[];

  const rooms = (await db
    .prepare(
      `SELECT DISTINCT room.code, room.name
       FROM incidents incident
       JOIN bookings booking ON booking.id = incident.booking_id
       JOIN rooms room ON room.id = booking.room_id
       WHERE ${scope.sql}
       ORDER BY room.name`,
    )
    .all(scope.parameters)) as Array<{ code: string; name: string }>;

  return {
    items: rows.map(mapIncident),
    total,
    page,
    pageSize: PAGE_SIZE,
    counts,
    rooms,
  };
}

export async function getBookingIncidents(
  db: RoomRelayDatabase,
  bookingId: string,
): Promise<BookingIncidentItem[]> {
  const rows = (await db
    .prepare(
      `SELECT
         id, status, category, description, created_at, resolution_note
       FROM incidents
       WHERE booking_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(bookingId)) as Array<{
    id: string;
    status: IncidentStatus;
    category: IncidentCategory;
    description: string;
    created_at: string;
    resolution_note: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    statusLabel: INCIDENT_STATUS_LABELS[row.status],
    category: row.category,
    categoryLabel: INCIDENT_CATEGORY_LABELS[row.category],
    description: row.description,
    createdAt: row.created_at,
    resolutionNote: row.resolution_note,
  }));
}

export async function getIncidentDetail(
  db: RoomRelayDatabase,
  actor: UserProfile,
  incidentId: string,
): Promise<IncidentDetail | null> {
  if (!isActiveProfile(actor)) {
    return null;
  }

  const scope = scopeFor(actor);
  const row = (await db
    .prepare(
      `${INCIDENT_SELECT}
       WHERE incident.id = ?
         AND (
           ${scope.sql}
           OR booking.requester_id = ?
         )`,
    )
    .get([incidentId, ...scope.parameters, actor.id])) as IncidentRow | undefined;

  if (!row) {
    return null;
  }

  const condition = (await db
    .prepare(
      `SELECT id, condition_state, notes, created_at
       FROM condition_reports
       WHERE booking_id = ? AND stage = 'after'
       LIMIT 1`,
    )
    .get(row.booking_id)) as
    | {
        id: string;
        condition_state: "left_as_found" | "issue_found";
        notes: string;
        created_at: string;
      }
    | undefined;

  const isAdmin = actor.role === "admin";
  const isAssignedManager =
    actor.role === "manager" && row.manager_id === actor.id;

  return {
    ...mapIncident(row),
    purpose: row.purpose,
    groupName: row.group_name,
    conditionReport: condition
      ? {
          id: condition.id,
          conditionState: condition.condition_state,
          notes: condition.notes,
          createdAt: condition.created_at,
        }
      : null,
    canReview: (isAdmin || isAssignedManager) && row.status === "open",
    canResolve: isAdmin && row.status !== "resolved",
  };
}
