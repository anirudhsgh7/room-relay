import type { UserProfile } from "@/lib/auth/service";
import { isActiveProfile } from "@/lib/authorization";
import type { RoomRelayDatabase } from "@/lib/db/client";
import { ACCESS_REASON_MESSAGES } from "@/lib/access/types";
import {
  campusLocalDayRange,
  formatCampusDate,
  formatCampusTime,
  formatCampusTimeRange,
} from "@/lib/time/campus-time";

export interface CredentialOption {
  id: string;
  label: string;
  maskedReference: string;
  type: "nfc_uid" | "demo_token";
  active: boolean;
  revokedAt: string | null;
}

export interface RoomOption {
  id: string;
  code: string;
  name: string;
  building: string;
}

export interface AccessBookingOption {
  id: string;
  roomId: string;
  roomCode: string;
  roomName: string;
  startAt: string;
  endAt: string;
  status: string;
  dateLabel: string;
  timeLabel: string;
}

export interface SimulatorData {
  credentials: CredentialOption[];
  rooms: RoomOption[];
  accessWindows: AccessBookingOption[];
  suggestedCredentialId: string;
  suggestedRoomId: string;
}

export interface AccessHistoryItem {
  id: string;
  occurredAt: string;
  dateLabel: string;
  timeLabel: string;
  roomCode: string;
  roomName: string;
  building: string;
  result: "allowed" | "denied";
  reasonCode: string;
  reasonMessage: string;
  source: "simulator" | "reader" | "seed";
  actorName: string | null;
  credentialLabel: string | null;
  credentialMasked: string | null;
  bookingId: string | null;
}

export interface AccessHistoryFilters {
  roomCode: string;
  result: "all" | "allowed" | "denied";
  reasonCode: string;
  date: string;
  page: number;
}

export interface ParsedAccessHistoryFilters {
  filters: AccessHistoryFilters;
  error?: string;
}

export interface AccessHistoryRoomOption {
  code: string;
  name: string;
}

export interface AccessHistoryResult {
  items: AccessHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
  rooms: AccessHistoryRoomOption[];
}

const PAGE_SIZE = 25;

const REASON_CODES = new Set(Object.keys(ACCESS_REASON_MESSAGES));

export function maskCredentialReference(reference: string): string {
  const suffix = reference.slice(-4);
  return `•••• ${suffix}`;
}

function credentialLabel(
  type: string,
  reference: string,
): { label: string; masked: string } {
  const displayType = type === "nfc_uid" ? "NFC card" : "Demo token";
  const masked = maskCredentialReference(reference);

  return {
    label: `${displayType} · ${masked}`,
    masked,
  };
}

export function getAccessSimulatorData(
  db: RoomRelayDatabase,
  profile: UserProfile,
): SimulatorData {
  const credentialRows = db
    .prepare(
      `SELECT id, credential_type, credential_ref, active, revoked_at
       FROM credentials
       WHERE user_id = ?
       ORDER BY active DESC, created_at DESC`,
    )
    .all(profile.id) as Array<{
    id: string;
    credential_type: "nfc_uid" | "demo_token";
    credential_ref: string;
    active: number;
    revoked_at: string | null;
  }>;

  const credentials: CredentialOption[] = credentialRows.map((credential) => {
    const display = credentialLabel(
      credential.credential_type,
      credential.credential_ref,
    );

    return {
      id: credential.id,
      label: display.label,
      maskedReference: display.masked,
      type: credential.credential_type,
      active: credential.active === 1,
      revokedAt: credential.revoked_at,
    };
  });

  const rooms = db
    .prepare(
      `SELECT id, code, name, building
       FROM rooms
       WHERE status = 'active'
       ORDER BY name, code`,
    )
    .all() as RoomOption[];

  const accessWindows = db
    .prepare(
      `SELECT
         b.id, b.room_id, b.start_at, b.end_at, b.status,
         r.code AS room_code, r.name AS room_name
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       WHERE b.requester_id = ?
         AND b.status IN ('approved', 'checked_in')
       ORDER BY b.start_at ASC
       LIMIT 12`,
    )
    .all(profile.id) as Array<{
    id: string;
    room_id: string;
    start_at: string;
    end_at: string;
    status: string;
    room_code: string;
    room_name: string;
  }>;

  const now = Date.now();
  const activeWindow = accessWindows.find(
    (window) =>
      Date.parse(window.start_at) <= now &&
      now < Date.parse(window.end_at),
  );
  const suggestedRoomId =
    activeWindow?.room_id ??
    accessWindows[0]?.room_id ??
    rooms[0]?.id ??
    "";
  const suggestedCredentialId =
    credentials.find((credential) => credential.active)?.id ?? "";

  return {
    credentials,
    rooms,
    accessWindows: accessWindows.map((window) => ({
      id: window.id,
      roomId: window.room_id,
      roomCode: window.room_code,
      roomName: window.room_name,
      startAt: window.start_at,
      endAt: window.end_at,
      status: window.status,
      dateLabel: formatCampusDate(window.start_at),
      timeLabel: formatCampusTimeRange(window.start_at, window.end_at),
    })),
    suggestedCredentialId,
    suggestedRoomId,
  };
}

function parseInteger(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function parseAccessHistoryFilters(
  raw: Record<string, string | string[] | undefined>,
): ParsedAccessHistoryFilters {
  const first = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  const rawDate = first(raw.date);
  let error: string | undefined;

  if (rawDate) {
    try {
      campusLocalDayRange(rawDate);
    } catch {
      error = "Enter a valid date for access history.";
    }
  }

  const rawResult = first(raw.result);
  const result =
    rawResult === "allowed" || rawResult === "denied" ? rawResult : "all";
  const rawReason = first(raw.reason);
  const reasonCode = REASON_CODES.has(rawReason) ? rawReason : "";
  const roomCode = first(raw.room).slice(0, 40);

  return {
    error,
    filters: {
      roomCode,
      result,
      reasonCode,
      date: error ? "" : rawDate,
      page: parseInteger(raw.page),
    },
  };
}

function historyScope(actor: UserProfile): {
  sql: string;
  parameters: string[];
} {
  if (actor.role === "admin") {
    return { sql: "1 = 1", parameters: [] };
  }

  if (actor.role === "manager") {
    return { sql: "room.manager_id = ?", parameters: [actor.id] };
  }

  return { sql: "event.actor_id = ?", parameters: [actor.id] };
}

export function listAccessHistory(
  db: RoomRelayDatabase,
  actor: UserProfile,
  filters: AccessHistoryFilters,
): AccessHistoryResult {
  if (!isActiveProfile(actor)) {
    return {
      items: [],
      total: 0,
      page: 1,
      pageSize: PAGE_SIZE,
      rooms: [],
    };
  }

  const scope = historyScope(actor);
  const conditions = [scope.sql];
  const parameters = [...scope.parameters];

  if (filters.roomCode) {
    conditions.push("room.code = ? COLLATE NOCASE");
    parameters.push(filters.roomCode);
  }
  if (filters.result !== "all") {
    conditions.push("event.result = ?");
    parameters.push(filters.result);
  }
  if (filters.reasonCode) {
    conditions.push("event.reason_code = ?");
    parameters.push(filters.reasonCode);
  }
  if (filters.date) {
    const range = campusLocalDayRange(filters.date);
    conditions.push("event.occurred_at >= ? AND event.occurred_at < ?");
    parameters.push(range.startUtc, range.endUtc);
  }

  const where = conditions.join(" AND ");
  const countRow = db
    .prepare(
      `SELECT count(*) AS count
       FROM access_events event
       JOIN rooms room ON room.id = event.room_id
       WHERE ${where}`,
    )
    .get(...parameters) as { count: number };

  const total = countRow.count;
  const page = Math.min(
    filters.page,
    Math.max(1, Math.ceil(total / PAGE_SIZE) || 1),
  );
  const offset = (page - 1) * PAGE_SIZE;

  const rows = db
    .prepare(
      `SELECT
         event.id, event.occurred_at, event.result, event.reason_code,
         event.source, event.booking_id,
         room.code AS room_code, room.name AS room_name, room.building,
         actor.display_name AS actor_name,
         credential.credential_ref, credential.credential_type
       FROM access_events event
       JOIN rooms room ON room.id = event.room_id
       LEFT JOIN profiles actor ON actor.id = event.actor_id
       LEFT JOIN credentials credential ON credential.id = event.credential_id
       WHERE ${where}
       ORDER BY event.occurred_at DESC, event.id DESC
       LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    )
    .all(...parameters) as Array<{
    id: string;
    occurred_at: string;
    result: "allowed" | "denied";
    reason_code: string;
    source: "simulator" | "reader" | "seed";
    booking_id: string | null;
    room_code: string;
    room_name: string;
    building: string;
    actor_name: string | null;
    credential_ref: string | null;
    credential_type: string | null;
  }>;

  const roomRows = db
    .prepare(
      `SELECT DISTINCT room.code, room.name
       FROM access_events event
       JOIN rooms room ON room.id = event.room_id
       WHERE ${scope.sql}
       ORDER BY room.name`,
    )
    .all(...scope.parameters) as AccessHistoryRoomOption[];

  return {
    rooms: roomRows,
    total,
    page,
    pageSize: PAGE_SIZE,
    items: rows.map((row) => {
      const credential =
        row.credential_ref && row.credential_type
          ? credentialLabel(row.credential_type, row.credential_ref)
          : null;

      return {
        id: row.id,
        occurredAt: row.occurred_at,
        dateLabel: formatCampusDate(row.occurred_at),
        timeLabel: formatCampusTime(row.occurred_at),
        roomCode: row.room_code,
        roomName: row.room_name,
        building: row.building,
        result: row.result,
        reasonCode: row.reason_code,
        reasonMessage:
          ACCESS_REASON_MESSAGES[row.reason_code] ??
          "Access attempt recorded.",
        source: row.source,
        actorName: row.actor_name,
        credentialLabel: credential?.label ?? null,
        credentialMasked: credential?.masked ?? null,
        bookingId: row.booking_id,
      };
    }),
  };
}
