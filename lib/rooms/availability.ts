import type { RoomRelayDatabase } from "@/lib/db/client";
import type { UserProfile } from "@/lib/auth/service";
import { findOverlappingBlackouts } from "@/lib/rooms/blackouts";
import { minutesToTime, type CampusInterval } from "@/lib/time/campus-time";

export interface BlockingBooking {
  id: string;
  roomId: string;
  startAt: string;
  endAt: string;
}

interface BlockingBookingRow {
  id: string;
  room_id: string;
  start_at: string;
  end_at: string;
}

export interface AvailabilityCheck {
  code: "available" | "conflict" | "outside_hours" | "blackout";
  conflictingBookingId?: string;
  blackoutReason?: string;
}

const CONFIRMED_STATUSES = ["approved", "checked_in"] as const;

/**
 * Confirmed bookings that block [startUtc, endUtc). Every confirmed booking
 * occupies its own interval plus the room's changeover buffer, and so does the
 * candidate, so the result does not depend on which booking was approved first.
 */
export async function getBlockingBookings(
  db: RoomRelayDatabase,
  roomId: string,
  startUtc: string,
  endUtc: string,
  bufferMinutes: number,
): Promise<BlockingBooking[]> {
  const rows = (await db
    .prepare(
      `SELECT id, room_id, start_at, end_at
       FROM bookings
       WHERE room_id = @room_id
         AND status IN ('approved', 'checked_in')
         AND start_at < @end_at::timestamptz + (@buffer * interval '1 minute')
         AND end_at + (@buffer * interval '1 minute') > @start_at::timestamptz
       ORDER BY start_at`,
    )
    .all({
      room_id: roomId,
      start_at: startUtc,
      end_at: endUtc,
      buffer: bufferMinutes,
    })) as BlockingBookingRow[];

  return rows.map((row) => ({
    id: row.id,
    roomId: row.room_id,
    startAt: row.start_at,
    endAt: row.end_at,
  }));
}

export async function getAllBlockingBookings(
  db: RoomRelayDatabase,
  roomId: string,
): Promise<BlockingBooking[]> {
  const rows = (await db
    .prepare(
      `SELECT id, room_id, start_at, end_at
       FROM bookings
       WHERE room_id = ?
         AND status IN ('approved', 'checked_in')
       ORDER BY start_at`,
    )
    .all(roomId)) as BlockingBookingRow[];

  return rows.map((row) => ({
    id: row.id,
    roomId: row.room_id,
    startAt: row.start_at,
    endAt: row.end_at,
  }));
}

export async function checkRoomSchedule(
  db: RoomRelayDatabase,
  roomId: string,
  date: string,
  weekday: number,
  startMinutes: number,
  endMinutes: number,
): Promise<boolean> {
  const rule = await db
    .prepare(
      `SELECT id
       FROM availability_rules
       WHERE room_id = ?
         AND weekday = ?
         AND active = 1
         AND effective_from <= ?
         AND (effective_until IS NULL OR effective_until >= ?)
         AND opens_at <= ?
         AND closes_at >= ?
       ORDER BY opens_at, closes_at
       LIMIT 1`,
    )
    .get([
      roomId,
      weekday,
      date,
      date,
      minutesToTime(startMinutes),
      minutesToTime(endMinutes),
    ]);

  return Boolean(rule);
}

export async function checkRoomAvailability(
  db: RoomRelayDatabase,
  input: {
    roomId: string;
    interval: CampusInterval;
    bufferMinutes: number;
  },
): Promise<AvailabilityCheck> {
  if (
    !(await checkRoomSchedule(
      db,
      input.roomId,
      input.interval.date,
      input.interval.weekday,
      input.interval.startMinutes,
      input.interval.endMinutes,
    ))
  ) {
    return { code: "outside_hours" };
  }

  const [blackout] = await findOverlappingBlackouts(
    db,
    input.roomId,
    input.interval.startUtc,
    input.interval.endUtc,
  );

  if (blackout) {
    return { code: "blackout", blackoutReason: blackout.reason };
  }

  const [conflict] = await getBlockingBookings(
    db,
    input.roomId,
    input.interval.startUtc,
    input.interval.endUtc,
    input.bufferMinutes,
  );

  if (conflict) {
    return { code: "conflict", conflictingBookingId: conflict.id };
  }

  return { code: "available" };
}

/**
 * The single conflict rule shared by discovery, requests, decisions, the
 * waitlist, and the database trigger: two bookings conflict when their
 * intervals, each extended by the changeover buffer, overlap.
 */
export function intervalsConflict(
  left: { startMs: number; endMs: number },
  right: { startMs: number; endMs: number },
  bufferMinutes: number,
): boolean {
  const buffer = bufferMinutes * 60_000;
  return left.startMs < right.endMs + buffer && right.startMs < left.endMs + buffer;
}

export function isConfirmedStatus(status: string): boolean {
  return CONFIRMED_STATUSES.includes(status as (typeof CONFIRMED_STATUSES)[number]);
}

export async function findPendingDuplicate(
  db: RoomRelayDatabase,
  input: {
    requesterId: string;
    roomId: string;
    startUtc: string;
    endUtc: string;
  },
): Promise<string | null> {
  const row = (await db
    .prepare(
      `SELECT id
       FROM bookings
       WHERE requester_id = @requester_id
         AND room_id = @room_id
         AND status IN ('pending', 'waitlisted')
         AND start_at < @end_at
         AND end_at > @start_at
       ORDER BY created_at
       LIMIT 1`,
    )
    .get({
      requester_id: input.requesterId,
      room_id: input.roomId,
      start_at: input.startUtc,
      end_at: input.endUtc,
    })) as { id: string } | undefined;

  return row?.id ?? null;
}

export async function findVerifiedRequirementIds(
  db: RoomRelayDatabase,
  profileId: string,
  roomId: string,
): Promise<Set<string>> {
  const rows = (await db
    .prepare(
      `SELECT er.id
       FROM eligibility_requirements er
       JOIN profile_eligibility pe
         ON pe.requirement_id = er.id
        AND pe.profile_id = ?
       WHERE er.room_id = ?
         AND er.active = 1
         AND er.required = 1
         AND pe.status = 'verified'
         AND (pe.expires_at IS NULL OR pe.expires_at > ?)`,
    )
    .all([profileId, roomId, new Date().toISOString()])) as Array<{ id: string }>;

  return new Set(rows.map((row) => row.id));
}

export function roomCanBeRequestedBy(
  profile: UserProfile,
  roomStatus: string,
  requestsEnabled: boolean,
): boolean {
  return (
    profile.role === "student" &&
    profile.status === "active" &&
    roomStatus === "active" &&
    requestsEnabled
  );
}
