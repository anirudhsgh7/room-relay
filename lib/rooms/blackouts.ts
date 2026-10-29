import type { RoomRelayDatabase } from "@/lib/db/client";
import type { RoomBlackoutSummary } from "@/lib/rooms/types";

interface BlackoutRow {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string;
}

function toSummary(row: BlackoutRow): RoomBlackoutSummary {
  return {
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    reason: row.reason,
  };
}

/** Active blackouts that overlap the half-open interval [startUtc, endUtc). */
export async function findOverlappingBlackouts(
  db: RoomRelayDatabase,
  roomId: string,
  startUtc: string,
  endUtc: string,
): Promise<RoomBlackoutSummary[]> {
  const rows = (await db
    .prepare(
      `SELECT id, starts_at, ends_at, reason
       FROM room_blackouts
       WHERE room_id = ?
         AND removed_at IS NULL
         AND starts_at < ?
         AND ends_at > ?
       ORDER BY starts_at`,
    )
    .all([roomId, endUtc, startUtc])) as BlackoutRow[];

  return rows.map(toSummary);
}

/** Active blackouts that have not ended yet, soonest first. */
export async function listUpcomingBlackouts(
  db: RoomRelayDatabase,
  roomId: string,
  nowIso = new Date().toISOString(),
  limit = 20,
): Promise<RoomBlackoutSummary[]> {
  const rows = (await db
    .prepare(
      `SELECT id, starts_at, ends_at, reason
       FROM room_blackouts
       WHERE room_id = ?
         AND removed_at IS NULL
         AND ends_at > ?
       ORDER BY starts_at
       LIMIT ?`,
    )
    .all([roomId, nowIso, limit])) as BlackoutRow[];

  return rows.map(toSummary);
}

/** Every active blackout for a room that ends after `fromIso`. */
export async function loadActiveBlackoutWindows(
  db: RoomRelayDatabase,
  roomId: string,
  fromIso: string,
): Promise<Array<{ startMs: number; endMs: number }>> {
  const rows = (await db
    .prepare(
      `SELECT starts_at, ends_at
       FROM room_blackouts
       WHERE room_id = ?
         AND removed_at IS NULL
         AND ends_at > ?`,
    )
    .all([roomId, fromIso])) as Array<{ starts_at: string; ends_at: string }>;

  return rows.map((row) => ({
    startMs: Date.parse(row.starts_at),
    endMs: Date.parse(row.ends_at),
  }));
}
