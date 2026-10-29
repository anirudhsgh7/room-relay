import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getProfileById, type UserProfile } from "@/lib/auth/service";
import { recordAudit } from "@/lib/audit";
import { cancelAsStaffInTransaction } from "@/lib/bookings/cancellation";
import type { RoomRelayDatabase } from "@/lib/db/client";
import type { BookingStatus } from "@/lib/domain";
import { createNotification } from "@/lib/notifications/service";
import {
  BUFFER_OPTIONS,
  DURATION_OPTIONS,
  NOTICE_OPTIONS,
  SLOT_OPTIONS,
} from "@/lib/admin/options";
import {
  ALLOCATION_RULES,
  POLICY_SELECT_COLUMNS,
  policyFromColumns,
  type PolicyColumns,
} from "@/lib/rooms/policy";
import type { RoomBlackoutSummary, RoomPolicy } from "@/lib/rooms/types";
import {
  addDaysToLocalDate,
  campusLocalToUtc,
  campusToday,
  formatCampusDate,
  formatCampusDateTime,
  localIntervalParts,
} from "@/lib/time/campus-time";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoomPermissions {
  canEditDetails: boolean;
  canAssignManager: boolean;
  canChangeStatus: boolean;
  canEditHours: boolean;
  canEditPolicy: boolean;
  canManageBlackouts: boolean;
}

export interface WeekdayHours {
  weekday: number;
  open: boolean;
  opensAt: string;
  closesAt: string;
}

export interface AdminBlackout extends RoomBlackoutSummary {
  createdByName: string;
  createdAt: string;
  label: string;
}

export interface ImpactedBooking {
  id: string;
  requesterName: string;
  status: BookingStatus;
  label: string;
  expectedAttendance: number;
  startAt: string;
  endAt: string;
}

export interface AdminRoomListItem {
  id: string;
  code: string;
  name: string;
  building: string;
  location: string;
  capacity: number;
  status: "active" | "inactive";
  managerName: string;
  requestsEnabled: boolean;
  openDays: number;
  pendingCount: number;
  waitlistCount: number;
  upcomingCount: number;
  nextBlackout: AdminBlackout | null;
}

export interface AdminRoomDetail {
  id: string;
  code: string;
  name: string;
  building: string;
  location: string;
  capacity: number;
  facilities: string[];
  policySummary: string;
  status: "active" | "inactive";
  managerId: string;
  managerName: string;
  policy: RoomPolicy;
  hours: WeekdayHours[];
  blackouts: AdminBlackout[];
  pendingCount: number;
  waitlistCount: number;
  upcomingCount: number;
}

export interface ManagerOption {
  id: string;
  displayName: string;
  roomCount: number;
}

export type AdminFieldErrors = Record<string, string>;

export type AdminResult<T> =
  | ({ ok: true } & T)
  | { ok: false; kind: "validation"; message: string; fieldErrors: AdminFieldErrors }
  | { ok: false; kind: "forbidden" | "not_found" | "conflict"; message: string }
  | {
      ok: false;
      kind: "needs_confirmation";
      message: string;
      impact: ImpactedBooking[];
      inUse: ImpactedBooking[];
    };

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export function roomPermissions(
  actor: UserProfile,
  room: { managerId: string },
): RoomPermissions | null {
  if (actor.status !== "active") {
    return null;
  }

  if (actor.role === "admin") {
    return {
      canEditDetails: true,
      canAssignManager: true,
      canChangeStatus: true,
      canEditHours: true,
      canEditPolicy: true,
      canManageBlackouts: true,
    };
  }

  if (actor.role === "manager" && room.managerId === actor.id) {
    return {
      canEditDetails: false,
      canAssignManager: false,
      canChangeStatus: false,
      canEditHours: true,
      canEditPolicy: true,
      canManageBlackouts: true,
    };
  }

  return null;
}

export function canUseRoomAdmin(actor: UserProfile): boolean {
  return (
    actor.status === "active" && (actor.role === "admin" || actor.role === "manager")
  );
}

/** Weekdays in the order people read a week: Monday first. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

interface RoomRow extends PolicyColumns {
  id: string;
  code: string;
  name: string;
  building: string;
  location: string;
  capacity: number;
  facilities: string;
  policy_summary: string;
  status: "active" | "inactive";
  manager_id: string;
  manager_name: string;
}

const ROOM_SELECT = `
  SELECT
    r.id, r.code, r.name, r.building, r.location, r.capacity, r.facilities,
    r.policy_summary, r.status, r.manager_id,
    manager.display_name AS manager_name,
    ${POLICY_SELECT_COLUMNS}
  FROM rooms r
  JOIN profiles manager ON manager.id = r.manager_id
  LEFT JOIN room_booking_policies policy ON policy.room_id = r.id
`;

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

function bookingCounts(
  db: RoomRelayDatabase,
  roomId: string,
  nowIso: string,
): { pendingCount: number; waitlistCount: number; upcomingCount: number } {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
         SUM(CASE WHEN status = 'waitlisted' THEN 1 ELSE 0 END) AS waitlist_count,
         SUM(CASE WHEN status IN ('approved', 'checked_in') THEN 1 ELSE 0 END) AS upcoming_count
       FROM bookings
       WHERE room_id = ?
         AND julianday(end_at) > julianday(?)`,
    )
    .get(roomId, nowIso) as {
    pending_count: number | null;
    waitlist_count: number | null;
    upcoming_count: number | null;
  };

  return {
    pendingCount: row.pending_count ?? 0,
    waitlistCount: row.waitlist_count ?? 0,
    upcomingCount: row.upcoming_count ?? 0,
  };
}

function loadBlackouts(
  db: RoomRelayDatabase,
  roomId: string,
  nowIso: string,
): AdminBlackout[] {
  const rows = db
    .prepare(
      `SELECT
         blackout.id, blackout.starts_at, blackout.ends_at, blackout.reason,
         blackout.created_at, creator.display_name AS created_by_name
       FROM room_blackouts blackout
       JOIN profiles creator ON creator.id = blackout.created_by
       WHERE blackout.room_id = ?
         AND blackout.removed_at IS NULL
         AND julianday(blackout.ends_at) > julianday(?)
       ORDER BY blackout.starts_at`,
    )
    .all(roomId, nowIso) as Array<{
    id: string;
    starts_at: string;
    ends_at: string;
    reason: string;
    created_at: string;
    created_by_name: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    reason: row.reason,
    createdAt: row.created_at,
    createdByName: row.created_by_name,
    label: blackoutLabel(row.starts_at, row.ends_at),
  }));
}

/**
 * A closure in words: "Mon, 2 Nov 2026 · 08:00–18:00", "Mon, 2 Nov 2026 · all
 * day", "Mon, 2 Nov 2026 – Wed, 4 Nov 2026 · all day", or a timed range.
 */
export function blackoutLabel(startsAt: string, endsAt: string): string {
  const start = localIntervalParts(startsAt, startsAt);
  const end = localIntervalParts(endsAt, endsAt);
  const startsAtMidnight = start.startMinutes === 0;
  const endsAtMidnight = end.startMinutes === 0;

  if (startsAtMidnight && endsAtMidnight && end.date > start.date) {
    // All-day closures end at the midnight that begins the following day.
    const lastDay = addDaysToLocalDate(end.date, -1);
    const firstLabel = formatCampusDate(startsAt);
    const lastLabel = formatCampusDate(campusLocalToUtc(lastDay, "12:00") ?? startsAt);

    return lastDay === start.date
      ? `${firstLabel} · all day`
      : `${firstLabel} – ${lastLabel} · all day`;
  }

  if (start.date === end.date) {
    return formatCampusDateTime(startsAt, endsAt);
  }

  return `${formatCampusDate(startsAt)} ${start.startTime} – ${formatCampusDate(
    endsAt,
  )} ${end.startTime}`;
}

function loadHours(db: RoomRelayDatabase, roomId: string): WeekdayHours[] {
  const rows = db
    .prepare(
      `SELECT weekday, opens_at, closes_at
       FROM availability_rules
       WHERE room_id = ? AND active = 1
       ORDER BY weekday, opens_at`,
    )
    .all(roomId) as Array<{ weekday: number; opens_at: string; closes_at: string }>;

  return WEEK_ORDER.map((weekday) => {
    const rule = rows.find((row) => row.weekday === weekday);
    return rule
      ? { weekday, open: true, opensAt: rule.opens_at, closesAt: rule.closes_at }
      : { weekday, open: false, opensAt: "09:00", closesAt: "17:00" };
  });
}

export function listAdminRooms(
  db: RoomRelayDatabase,
  actor: UserProfile,
): AdminRoomListItem[] {
  if (!canUseRoomAdmin(actor)) {
    return [];
  }

  const nowIso = new Date().toISOString();
  const rows = (
    actor.role === "admin"
      ? db.prepare(`${ROOM_SELECT} ORDER BY r.status, r.building, r.name`).all()
      : db
          .prepare(`${ROOM_SELECT} WHERE r.manager_id = ? ORDER BY r.status, r.building, r.name`)
          .all(actor.id)
  ) as RoomRow[];

  return rows.map((row) => {
    const openDays = (
      db
        .prepare(
          "SELECT count(DISTINCT weekday) AS count FROM availability_rules WHERE room_id = ? AND active = 1",
        )
        .get(row.id) as { count: number }
    ).count;

    return {
      id: row.id,
      code: row.code,
      name: row.name,
      building: row.building,
      location: row.location,
      capacity: row.capacity,
      status: row.status,
      managerName: row.manager_name,
      requestsEnabled: row.requests_enabled === 1,
      openDays,
      nextBlackout: loadBlackouts(db, row.id, nowIso)[0] ?? null,
      ...bookingCounts(db, row.id, nowIso),
    };
  });
}

export function getAdminRoom(
  db: RoomRelayDatabase,
  actor: UserProfile,
  roomId: string,
): { room: AdminRoomDetail; permissions: RoomPermissions } | null {
  const row = db.prepare(`${ROOM_SELECT} WHERE r.id = ?`).get(roomId) as
    | RoomRow
    | undefined;

  if (!row) {
    return null;
  }

  const permissions = roomPermissions(actor, { managerId: row.manager_id });

  if (!permissions) {
    return null;
  }

  const nowIso = new Date().toISOString();

  return {
    permissions,
    room: {
      id: row.id,
      code: row.code,
      name: row.name,
      building: row.building,
      location: row.location,
      capacity: row.capacity,
      facilities: parseFacilities(row.facilities),
      policySummary: row.policy_summary,
      status: row.status,
      managerId: row.manager_id,
      managerName: row.manager_name,
      policy: policyFromColumns(row),
      hours: loadHours(db, row.id),
      blackouts: loadBlackouts(db, row.id, nowIso),
      ...bookingCounts(db, row.id, nowIso),
    },
  };
}

export function listAssignableManagers(db: RoomRelayDatabase): ManagerOption[] {
  return (
    db
      .prepare(
        `SELECT p.id, p.display_name,
           (SELECT count(*) FROM rooms r WHERE r.manager_id = p.id) AS room_count
         FROM profiles p
         WHERE p.role = 'manager' AND p.status = 'active'
         ORDER BY p.display_name`,
      )
      .all() as Array<{ id: string; display_name: string; room_count: number }>
  ).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    roomCount: row.room_count,
  }));
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function fieldErrors(error: z.ZodError): AdminFieldErrors {
  const result: AdminFieldErrors = {};

  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "form";
    if (!result[key]) {
      result[key] = issue.message;
    }
  }

  return result;
}

function validationFailure(error: z.ZodError) {
  return {
    ok: false as const,
    kind: "validation" as const,
    message: error.issues[0]?.message ?? "Check the highlighted fields.",
    fieldErrors: fieldErrors(error),
  };
}

export function parseFacilityList(value: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of value.split(/[,\n]/)) {
    const item = raw.trim().replace(/\s+/g, " ");
    const key = item.toLowerCase();

    if (item && !seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

const timeField = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00.");

const detailsSchema = z.object({
  name: z.string().trim().min(2, "Enter the room name.").max(80, "Keep the name under 80 characters."),
  building: z.string().trim().min(2, "Enter the building.").max(80, "Keep the building under 80 characters."),
  location: z.string().trim().min(2, "Say where the room is, e.g. Second floor, east wing.").max(120, "Keep the location under 120 characters."),
  capacity: z.coerce
    .number({ error: "Enter the number of seats." })
    .int("Seats must be a whole number.")
    .min(1, "A room needs at least 1 seat.")
    .max(2000, "Seats must be 2,000 or fewer."),
  facilities: z
    .string()
    .max(800)
    .transform(parseFacilityList)
    .pipe(
      z
        .array(z.string().max(40, "Keep each facility under 40 characters."))
        .max(15, "List up to 15 facilities."),
    ),
  policySummary: z.string().trim().max(400, "Keep the usage note under 400 characters.").default(""),
  managerId: z.string().trim().min(1, "Choose who manages this room."),
});

const createSchema = detailsSchema.extend({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z0-9][A-Z0-9-]{1,15}$/,
      "Use 2–16 letters, numbers, or dashes, e.g. SEM-03.",
    ),
});

const updateSchema = detailsSchema.extend({
  status: z.enum(["active", "inactive"]),
  confirmImpact: z.boolean().default(false),
});

function requireActiveManager(
  db: RoomRelayDatabase,
  managerId: string,
): boolean {
  const row = db
    .prepare("SELECT 1 FROM profiles WHERE id = ? AND role = 'manager' AND status = 'active'")
    .get(managerId);
  return Boolean(row);
}

function freshActor(
  db: RoomRelayDatabase,
  actor: UserProfile,
): UserProfile | null {
  const fresh = getProfileById(db, actor.id);
  return fresh && fresh.status === "active" ? fresh : null;
}

function loadRoomRow(db: RoomRelayDatabase, roomId: string): RoomRow | null {
  return (db.prepare(`${ROOM_SELECT} WHERE r.id = ?`).get(roomId) as RoomRow | undefined) ?? null;
}

interface ImpactRow {
  id: string;
  requester_name: string;
  status: BookingStatus;
  start_at: string;
  end_at: string;
  expected_attendance: number;
}

function toImpact(row: ImpactRow): ImpactedBooking {
  return {
    id: row.id,
    requesterName: row.requester_name,
    status: row.status,
    label: formatCampusDateTime(row.start_at, row.end_at),
    expectedAttendance: row.expected_attendance,
    startAt: row.start_at,
    endAt: row.end_at,
  };
}

function bookingsInWindow(
  db: RoomRelayDatabase,
  roomId: string,
  startIso: string,
  endIso: string,
  statuses: BookingStatus[],
): ImpactedBooking[] {
  const list = statuses.map((status) => `'${status}'`).join(", ");
  const rows = db
    .prepare(
      `SELECT b.id, b.status, b.start_at, b.end_at, b.expected_attendance,
         requester.display_name AS requester_name
       FROM bookings b
       JOIN profiles requester ON requester.id = b.requester_id
       WHERE b.room_id = ?
         AND b.status IN (${list})
         AND julianday(b.start_at) < julianday(?)
         AND julianday(b.end_at) > julianday(?)
       ORDER BY b.start_at`,
    )
    .all(roomId, endIso, startIso) as ImpactRow[];

  return rows.map(toImpact);
}

const FAR_FUTURE = "9999-12-31T23:59:59.000Z";

// ---------------------------------------------------------------------------
// Create and update room details
// ---------------------------------------------------------------------------

export interface RoomDetailsInput {
  code?: string;
  name: string;
  building: string;
  location: string;
  capacity: string | number;
  facilities: string;
  policySummary: string;
  managerId: string;
  status?: string;
  confirmImpact?: boolean;
}

const DEFAULT_NEW_ROOM_HOURS = { opensAt: "09:00", closesAt: "17:00", weekdays: [1, 2, 3, 4, 5] };

export function createRoom(
  db: RoomRelayDatabase,
  actor: UserProfile,
  input: RoomDetailsInput,
): AdminResult<{ roomId: string }> {
  const parsed = createSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const data = parsed.data;

  const execute = db.transaction((): AdminResult<{ roomId: string }> => {
    const fresh = freshActor(db, actor);

    if (!fresh || fresh.role !== "admin") {
      return { ok: false, kind: "forbidden", message: "Only administrators can add rooms." };
    }

    if (!requireActiveManager(db, data.managerId)) {
      return {
        ok: false,
        kind: "validation",
        message: "Choose an active room manager.",
        fieldErrors: { managerId: "Choose an active room manager." },
      };
    }

    const existing = db.prepare("SELECT 1 FROM rooms WHERE code = ? COLLATE NOCASE").get(data.code);

    if (existing) {
      return {
        ok: false,
        kind: "validation",
        message: `Room code ${data.code} is already in use.`,
        fieldErrors: { code: `${data.code} is already in use. Codes must be unique.` },
      };
    }

    const nowIso = new Date().toISOString();
    const roomId = `room_${randomUUID()}`;

    db.prepare(
      `INSERT INTO rooms (
         id, code, name, building, location, capacity, facilities,
         policy_summary, manager_id, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(
      roomId,
      data.code,
      data.name,
      data.building,
      data.location,
      data.capacity,
      JSON.stringify(data.facilities),
      data.policySummary,
      data.managerId,
      nowIso,
      nowIso,
    );

    db.prepare(
      `INSERT INTO room_booking_policies (room_id, requests_enabled, updated_at)
       VALUES (?, 1, ?)`,
    ).run(roomId, nowIso);

    const effectiveFrom = campusToday();
    const insertRule = db.prepare(
      `INSERT INTO availability_rules (
         id, room_id, weekday, opens_at, closes_at, effective_from,
         effective_until, active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`,
    );

    for (const weekday of DEFAULT_NEW_ROOM_HOURS.weekdays) {
      insertRule.run(
        `avail_${randomUUID()}`,
        roomId,
        weekday,
        DEFAULT_NEW_ROOM_HOURS.opensAt,
        DEFAULT_NEW_ROOM_HOURS.closesAt,
        effectiveFrom,
        nowIso,
        nowIso,
      );
    }

    recordAudit(db, {
      actorId: fresh.id,
      action: "room.created",
      entityType: "room",
      entityId: roomId,
      occurredAt: nowIso,
      summary: `${fresh.displayName} added ${data.name} (${data.code}).`,
      correlationId: `room-create:${randomUUID()}`,
      metadata: { code: data.code, managerId: data.managerId, capacity: data.capacity },
    });

    createNotification(db, {
      recipientId: data.managerId,
      kind: "room_assignment",
      title: `You now manage ${data.name}`,
      body: `${fresh.displayName} added ${data.name} (${data.code}) and assigned it to you. Requests for it will appear in your review queue.`,
      linkPath: `/app/admin/rooms/${roomId}`,
      createdAt: nowIso,
    });

    return { ok: true, roomId };
  });

  return execute.immediate();
}

export function updateRoomDetails(
  db: RoomRelayDatabase,
  actor: UserProfile,
  roomId: string,
  input: RoomDetailsInput,
): AdminResult<{ cancelledCount: number; overCapacity: ImpactedBooking[] }> {
  const parsed = updateSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const data = parsed.data;
  type Result = AdminResult<{ cancelledCount: number; overCapacity: ImpactedBooking[] }>;

  const execute = db.transaction((): Result => {
    const fresh = freshActor(db, actor);
    const room = loadRoomRow(db, roomId);

    if (!fresh || !room) {
      return { ok: false, kind: "not_found", message: "That room could not be found." };
    }

    const permissions = roomPermissions(fresh, { managerId: room.manager_id });

    if (!permissions?.canEditDetails) {
      return {
        ok: false,
        kind: "forbidden",
        message: "Only administrators can change room details.",
      };
    }

    if (!requireActiveManager(db, data.managerId)) {
      return {
        ok: false,
        kind: "validation",
        message: "Choose an active room manager.",
        fieldErrors: { managerId: "Choose an active room manager." },
      };
    }

    const nowIso = new Date().toISOString();
    const deactivating = room.status === "active" && data.status === "inactive";
    let cancelledCount = 0;

    if (deactivating) {
      const impact = bookingsInWindow(db, room.id, nowIso, FAR_FUTURE, [
        "pending",
        "waitlisted",
        "approved",
      ]);
      const inUse = bookingsInWindow(db, room.id, nowIso, FAR_FUTURE, ["checked_in"]);

      if ((impact.length > 0 || inUse.length > 0) && !data.confirmImpact) {
        return {
          ok: false,
          kind: "needs_confirmation",
          message:
            impact.length > 0
              ? `Closing this room cancels ${impact.length} upcoming ${
                  impact.length === 1 ? "booking or request" : "bookings and requests"
                }. Each person is told why.`
              : "This room is in use right now. The current booking will finish normally.",
          impact,
          inUse,
        };
      }

      const correlationId = randomUUID();

      for (const booking of impact) {
        const cancelled = cancelAsStaffInTransaction(db, {
          actor: fresh,
          bookingId: booking.id,
          reason: `${room.name} is closed and no longer taking bookings.`,
          nowIso,
          correlationId,
          releaseToWaitlist: false,
        });
        cancelledCount += cancelled ? 1 : 0;
      }
    }

    db.prepare(
      `UPDATE rooms
       SET name = ?, building = ?, location = ?, capacity = ?, facilities = ?,
           policy_summary = ?, manager_id = ?, status = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      data.name,
      data.building,
      data.location,
      data.capacity,
      JSON.stringify(data.facilities),
      data.policySummary,
      data.managerId,
      data.status,
      nowIso,
      room.id,
    );

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const compare: Array<[string, unknown, unknown]> = [
      ["name", room.name, data.name],
      ["building", room.building, data.building],
      ["location", room.location, data.location],
      ["capacity", room.capacity, data.capacity],
      ["facilities", parseFacilities(room.facilities), data.facilities],
      ["policySummary", room.policy_summary, data.policySummary],
      ["managerId", room.manager_id, data.managerId],
      ["status", room.status, data.status],
    ];

    for (const [key, from, to] of compare) {
      if (JSON.stringify(from) !== JSON.stringify(to)) {
        changes[key] = { from, to };
      }
    }

    if (Object.keys(changes).length > 0) {
      recordAudit(db, {
        actorId: fresh.id,
        action: deactivating ? "room.deactivated" : "room.updated",
        entityType: "room",
        entityId: room.id,
        occurredAt: nowIso,
        summary: deactivating
          ? `${fresh.displayName} closed ${data.name}; ${cancelledCount} upcoming ${
              cancelledCount === 1 ? "booking was" : "bookings were"
            } cancelled.`
          : `${fresh.displayName} updated ${data.name}.`,
        correlationId: `room-update:${randomUUID()}`,
        metadata: { changes, cancelledCount },
      });
    }

    if (room.manager_id !== data.managerId) {
      createNotification(db, {
        recipientId: data.managerId,
        kind: "room_assignment",
        title: `You now manage ${data.name}`,
        body: `${fresh.displayName} assigned ${data.name} (${room.code}) to you. Its pending requests are now in your review queue.`,
        linkPath: `/app/admin/rooms/${room.id}`,
        createdAt: nowIso,
      });
      createNotification(db, {
        recipientId: room.manager_id,
        kind: "room_assignment",
        title: `${data.name} was reassigned`,
        body: `${fresh.displayName} moved ${data.name} (${room.code}) to another manager. You no longer review its requests.`,
        createdAt: nowIso,
      });
    }

    const overCapacity = bookingsInWindow(db, room.id, nowIso, FAR_FUTURE, [
      "pending",
      "approved",
    ]).filter((booking) => booking.expectedAttendance > data.capacity);

    return { ok: true, cancelledCount, overCapacity };
  });

  return execute.immediate();
}

// ---------------------------------------------------------------------------
// Opening hours
// ---------------------------------------------------------------------------

const hoursSchema = z
  .array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      open: z.boolean(),
      opensAt: z.string(),
      closesAt: z.string(),
    }),
  )
  .length(7)
  .superRefine((days, context) => {
    const seen = new Set<number>();

    for (const day of days) {
      if (seen.has(day.weekday)) {
        context.addIssue({ code: "custom", message: "Each weekday may appear once.", path: [] });
      }
      seen.add(day.weekday);

      if (!day.open) {
        continue;
      }

      const name = WEEKDAY_NAMES[day.weekday];

      if (!timeField.safeParse(day.opensAt).success || !timeField.safeParse(day.closesAt).success) {
        context.addIssue({
          code: "custom",
          message: `${name}: use times like 09:00.`,
          path: [String(day.weekday)],
        });
      } else if (day.opensAt >= day.closesAt) {
        context.addIssue({
          code: "custom",
          message: `${name}: closing time must be after opening time.`,
          path: [String(day.weekday)],
        });
      }
    }
  });

export function updateRoomHours(
  db: RoomRelayDatabase,
  actor: UserProfile,
  roomId: string,
  days: WeekdayHours[],
): AdminResult<{ outsideHours: ImpactedBooking[] }> {
  const parsed = hoursSchema.safeParse(days);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  type Result = AdminResult<{ outsideHours: ImpactedBooking[] }>;

  const execute = db.transaction((): Result => {
    const fresh = freshActor(db, actor);
    const room = loadRoomRow(db, roomId);

    if (!fresh || !room) {
      return { ok: false, kind: "not_found", message: "That room could not be found." };
    }

    if (!roomPermissions(fresh, { managerId: room.manager_id })?.canEditHours) {
      return { ok: false, kind: "forbidden", message: "You cannot change this room's hours." };
    }

    const nowIso = new Date().toISOString();
    const before = loadHours(db, room.id);
    const effectiveFrom = campusToday();

    db.prepare("DELETE FROM availability_rules WHERE room_id = ?").run(room.id);

    const insertRule = db.prepare(
      `INSERT INTO availability_rules (
         id, room_id, weekday, opens_at, closes_at, effective_from,
         effective_until, active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`,
    );

    for (const day of parsed.data) {
      if (day.open) {
        insertRule.run(
          `avail_${randomUUID()}`,
          room.id,
          day.weekday,
          day.opensAt,
          day.closesAt,
          effectiveFrom,
          nowIso,
          nowIso,
        );
      }
    }

    recordAudit(db, {
      actorId: fresh.id,
      action: "room.hours_updated",
      entityType: "room",
      entityId: room.id,
      occurredAt: nowIso,
      summary: `${fresh.displayName} updated the opening hours for ${room.name}.`,
      correlationId: `room-hours:${randomUUID()}`,
      metadata: { before, after: parsed.data },
    });

    const outsideHours = bookingsInWindow(db, room.id, nowIso, FAR_FUTURE, [
      "approved",
      "pending",
    ]).filter((booking) => {
      const local = localIntervalParts(booking.startAt, booking.endAt);
      const day = parsed.data.find((item) => item.weekday === local.weekday);

      return (
        !day ||
        !day.open ||
        day.opensAt > local.startTime ||
        day.closesAt < local.endTime
      );
    });

    return { ok: true, outsideHours };
  });

  return execute.immediate();
}

// ---------------------------------------------------------------------------
// Booking rules
// ---------------------------------------------------------------------------


function oneOf<T extends readonly number[]>(options: T, message: string) {
  return z.coerce
    .number()
    .refine((value) => (options as readonly number[]).includes(value), { message });
}

const policySchema = z.object({
  requestsEnabled: z.boolean(),
  waitlistEnabled: z.boolean(),
  slotIntervalMinutes: oneOf(SLOT_OPTIONS, "Choose a time increment from the list."),
  minimumNoticeMinutes: oneOf(NOTICE_OPTIONS, "Choose a notice period from the list."),
  maximumDurationMinutes: oneOf(DURATION_OPTIONS, "Choose a longest booking from the list."),
  bufferMinutes: oneOf(BUFFER_OPTIONS, "Choose a changeover gap from the list."),
  maxAdvanceDays: z.coerce
    .number({ error: "Enter a number of days." })
    .int("Use a whole number of days.")
    .min(1, "Allow at least 1 day ahead.")
    .max(365, "Allow at most 365 days ahead."),
  maxActivePerRequester: z.coerce
    .number({ error: "Enter a number (0 for no limit)." })
    .int("Use a whole number.")
    .min(0, "Use 0 for no limit.")
    .max(50, "Use 50 or fewer."),
  allocationRule: z.enum(ALLOCATION_RULES, { error: "Choose how competing requests are ranked." }),
});

export type PolicyInput = z.input<typeof policySchema>;

/**
 * Pairs of upcoming confirmed bookings that would be closer together than a
 * proposed changeover gap. Raising the gap past these would make the existing
 * schedule invalid, so it is refused until they are resolved.
 */
function bufferViolations(
  db: RoomRelayDatabase,
  roomId: string,
  bufferMinutes: number,
  nowIso: string,
): Array<{ first: ImpactedBooking; second: ImpactedBooking }> {
  const rows = db
    .prepare(
      `SELECT b.id, b.status, b.start_at, b.end_at, b.expected_attendance,
         requester.display_name AS requester_name
       FROM bookings b
       JOIN profiles requester ON requester.id = b.requester_id
       WHERE b.room_id = ?
         AND b.status IN ('approved', 'checked_in')
         AND julianday(b.end_at) > julianday(?)
       ORDER BY b.start_at`,
    )
    .all(roomId, nowIso) as ImpactRow[];
  const violations: Array<{ first: ImpactedBooking; second: ImpactedBooking }> = [];

  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]!;
    const current = rows[index]!;

    if (Date.parse(current.start_at) < Date.parse(previous.end_at) + bufferMinutes * 60_000) {
      violations.push({ first: toImpact(previous), second: toImpact(current) });
    }
  }

  return violations;
}

export function updateRoomPolicy(
  db: RoomRelayDatabase,
  actor: UserProfile,
  roomId: string,
  input: PolicyInput,
): AdminResult<{ policy: RoomPolicy }> {
  const parsed = policySchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const data = parsed.data;
  type Result = AdminResult<{ policy: RoomPolicy }>;

  const execute = db.transaction((): Result => {
    const fresh = freshActor(db, actor);
    const room = loadRoomRow(db, roomId);

    if (!fresh || !room) {
      return { ok: false, kind: "not_found", message: "That room could not be found." };
    }

    if (!roomPermissions(fresh, { managerId: room.manager_id })?.canEditPolicy) {
      return { ok: false, kind: "forbidden", message: "You cannot change this room's booking rules." };
    }

    const before = policyFromColumns(room);
    const nowIso = new Date().toISOString();

    if (data.bufferMinutes > before.bufferMinutes) {
      const violations = bufferViolations(db, room.id, data.bufferMinutes, nowIso);

      if (violations.length > 0) {
        const first = violations[0]!;
        return {
          ok: false,
          kind: "conflict",
          message: `A ${data.bufferMinutes}-minute changeover gap would clash with ${violations.length} pair${
            violations.length === 1 ? "" : "s"
          } of upcoming bookings already approved (for example ${first.first.label} and ${first.second.label}). Keep the current gap, or move one of those bookings first.`,
        };
      }
    }

    db.prepare(
      `INSERT INTO room_booking_policies (
         room_id, requests_enabled, slot_interval_minutes, minimum_notice_minutes,
         maximum_duration_minutes, buffer_minutes, max_advance_days,
         max_active_per_requester, allocation_rule, waitlist_enabled, updated_at
       ) VALUES (
         @room_id, @requests_enabled, @slot, @notice, @duration, @buffer, @advance,
         @per_person, @rule, @waitlist, @now
       )
       ON CONFLICT(room_id) DO UPDATE SET
         requests_enabled = excluded.requests_enabled,
         slot_interval_minutes = excluded.slot_interval_minutes,
         minimum_notice_minutes = excluded.minimum_notice_minutes,
         maximum_duration_minutes = excluded.maximum_duration_minutes,
         buffer_minutes = excluded.buffer_minutes,
         max_advance_days = excluded.max_advance_days,
         max_active_per_requester = excluded.max_active_per_requester,
         allocation_rule = excluded.allocation_rule,
         waitlist_enabled = excluded.waitlist_enabled,
         updated_at = excluded.updated_at`,
    ).run({
      room_id: room.id,
      requests_enabled: data.requestsEnabled ? 1 : 0,
      slot: data.slotIntervalMinutes,
      notice: data.minimumNoticeMinutes,
      duration: data.maximumDurationMinutes,
      buffer: data.bufferMinutes,
      advance: data.maxAdvanceDays,
      per_person: data.maxActivePerRequester,
      rule: data.allocationRule,
      waitlist: data.waitlistEnabled ? 1 : 0,
      now: nowIso,
    });

    const after: RoomPolicy = {
      requestsEnabled: data.requestsEnabled,
      waitlistEnabled: data.waitlistEnabled,
      slotIntervalMinutes: data.slotIntervalMinutes,
      minimumNoticeMinutes: data.minimumNoticeMinutes,
      maximumDurationMinutes: data.maximumDurationMinutes,
      bufferMinutes: data.bufferMinutes,
      maxAdvanceDays: data.maxAdvanceDays,
      maxActivePerRequester: data.maxActivePerRequester,
      allocationRule: data.allocationRule,
    };

    recordAudit(db, {
      actorId: fresh.id,
      action: "room.policy_updated",
      entityType: "room",
      entityId: room.id,
      occurredAt: nowIso,
      summary: `${fresh.displayName} updated the booking rules for ${room.name}.`,
      correlationId: `room-policy:${randomUUID()}`,
      metadata: { before, after },
    });

    return { ok: true, policy: after };
  });

  return execute.immediate();
}

// ---------------------------------------------------------------------------
// Closures (blackouts)
// ---------------------------------------------------------------------------

const blackoutSchema = z
  .object({
    startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date."),
    endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an end date."),
    allDay: z.boolean(),
    startTime: z.string().trim().default(""),
    endTime: z.string().trim().default(""),
    reason: z
      .string()
      .trim()
      .min(5, "Give a short reason people will see, e.g. Carpet replacement.")
      .max(200, "Keep the reason under 200 characters."),
    confirmImpact: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if (!value.allDay) {
      if (!timeField.safeParse(value.startTime).success) {
        context.addIssue({ code: "custom", message: "Use a start time like 08:00.", path: ["startTime"] });
      }
      if (!timeField.safeParse(value.endTime).success) {
        context.addIssue({ code: "custom", message: "Use an end time like 18:00.", path: ["endTime"] });
      }
    }
  });

export type BlackoutInput = z.input<typeof blackoutSchema>;

function blackoutWindow(
  data: z.output<typeof blackoutSchema>,
): { startsAt: string; endsAt: string } | null {
  const startsAt = campusLocalToUtc(data.startDate, data.allDay ? "00:00" : data.startTime);
  let endsAt: string | null;

  if (data.allDay) {
    // An all-day closure runs to the midnight that starts the next day.
    let nextDay: string;
    try {
      nextDay = addDaysToLocalDate(data.endDate, 1);
    } catch {
      return null;
    }
    endsAt = campusLocalToUtc(nextDay, "00:00");
  } else {
    endsAt = campusLocalToUtc(data.endDate, data.endTime);
  }

  return startsAt && endsAt ? { startsAt, endsAt } : null;
}

export function addBlackout(
  db: RoomRelayDatabase,
  actor: UserProfile,
  roomId: string,
  input: BlackoutInput,
): AdminResult<{ blackoutId: string; cancelledCount: number }> {
  const parsed = blackoutSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const data = parsed.data;
  const window = blackoutWindow(data);

  if (!window) {
    return {
      ok: false,
      kind: "validation",
      message: "Enter valid dates and times.",
      fieldErrors: { startDate: "Enter valid dates and times." },
    };
  }

  if (Date.parse(window.endsAt) <= Date.parse(window.startsAt)) {
    return {
      ok: false,
      kind: "validation",
      message: "The closure must end after it starts.",
      fieldErrors: { endDate: "The closure must end after it starts." },
    };
  }

  type Result = AdminResult<{ blackoutId: string; cancelledCount: number }>;

  const execute = db.transaction((): Result => {
    const fresh = freshActor(db, actor);
    const room = loadRoomRow(db, roomId);

    if (!fresh || !room) {
      return { ok: false, kind: "not_found", message: "That room could not be found." };
    }

    if (!roomPermissions(fresh, { managerId: room.manager_id })?.canManageBlackouts) {
      return { ok: false, kind: "forbidden", message: "You cannot add closures for this room." };
    }

    const nowIso = new Date().toISOString();

    if (Date.parse(window.startsAt) < Date.parse(nowIso) - 60_000) {
      return {
        ok: false,
        kind: "validation",
        message: "A closure cannot start in the past. Start it now or later.",
        fieldErrors: { startDate: "A closure cannot start in the past." },
      };
    }

    const impact = bookingsInWindow(db, room.id, window.startsAt, window.endsAt, [
      "pending",
      "waitlisted",
      "approved",
    ]);
    const inUse = bookingsInWindow(db, room.id, window.startsAt, window.endsAt, ["checked_in"]);

    if ((impact.length > 0 || inUse.length > 0) && !data.confirmImpact) {
      return {
        ok: false,
        kind: "needs_confirmation",
        message:
          impact.length > 0
            ? `This closure overlaps ${impact.length} ${
                impact.length === 1 ? "booking or request" : "bookings and requests"
              }. Adding it cancels them and tells each person why.`
            : "This closure overlaps a booking that is in use right now. That booking will not be interrupted.",
        impact,
        inUse,
      };
    }

    const blackoutId = `blackout_${randomUUID()}`;
    const correlationId = randomUUID();

    db.prepare(
      `INSERT INTO room_blackouts (
         id, room_id, starts_at, ends_at, reason, created_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(blackoutId, room.id, window.startsAt, window.endsAt, data.reason, fresh.id, nowIso);

    let cancelledCount = 0;

    for (const booking of impact) {
      const cancelled = cancelAsStaffInTransaction(db, {
        actor: fresh,
        bookingId: booking.id,
        reason: `Room closed: ${data.reason}`,
        nowIso,
        correlationId,
        releaseToWaitlist: false,
      });
      cancelledCount += cancelled ? 1 : 0;
    }

    recordAudit(db, {
      actorId: fresh.id,
      action: "room.blackout_added",
      entityType: "room",
      entityId: room.id,
      occurredAt: nowIso,
      summary: `${fresh.displayName} closed ${room.name} for ${blackoutLabel(
        window.startsAt,
        window.endsAt,
      )}: ${data.reason}`,
      correlationId: `room-blackout:${correlationId}`,
      metadata: {
        blackoutId,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        reason: data.reason,
        cancelledBookingIds: impact.map((booking) => booking.id),
      },
    });

    return { ok: true, blackoutId, cancelledCount };
  });

  return execute.immediate();
}

export function removeBlackout(
  db: RoomRelayDatabase,
  actor: UserProfile,
  roomId: string,
  blackoutId: string,
): AdminResult<Record<never, never>> {
  type Result = AdminResult<Record<never, never>>;

  const execute = db.transaction((): Result => {
    const fresh = freshActor(db, actor);
    const room = loadRoomRow(db, roomId);

    if (!fresh || !room) {
      return { ok: false, kind: "not_found", message: "That room could not be found." };
    }

    if (!roomPermissions(fresh, { managerId: room.manager_id })?.canManageBlackouts) {
      return { ok: false, kind: "forbidden", message: "You cannot change closures for this room." };
    }

    const blackout = db
      .prepare(
        "SELECT id, starts_at, ends_at, reason FROM room_blackouts WHERE id = ? AND room_id = ? AND removed_at IS NULL",
      )
      .get(blackoutId, room.id) as
      | { id: string; starts_at: string; ends_at: string; reason: string }
      | undefined;

    if (!blackout) {
      return { ok: false, kind: "not_found", message: "That closure was already removed." };
    }

    const nowIso = new Date().toISOString();

    db.prepare(
      "UPDATE room_blackouts SET removed_at = ?, removed_by = ? WHERE id = ? AND removed_at IS NULL",
    ).run(nowIso, fresh.id, blackout.id);

    recordAudit(db, {
      actorId: fresh.id,
      action: "room.blackout_removed",
      entityType: "room",
      entityId: room.id,
      occurredAt: nowIso,
      summary: `${fresh.displayName} reopened ${room.name} for ${blackoutLabel(
        blackout.starts_at,
        blackout.ends_at,
      )}.`,
      correlationId: `room-blackout-remove:${randomUUID()}`,
      metadata: { blackoutId: blackout.id, reason: blackout.reason },
    });

    return { ok: true };
  });

  return execute.immediate();
}
