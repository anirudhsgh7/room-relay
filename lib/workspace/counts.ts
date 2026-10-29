import type { UserProfile } from "@/lib/auth/service";
import type { RoomRelayDatabase } from "@/lib/db/client";
import { countUnreadNotifications } from "@/lib/notifications/service";

export interface WorkspaceCounts {
  unread: number;
  toReview: number;
  openIssues: number;
}

/** Badge counts for the navigation, scoped exactly like the pages they open. */
export async function getWorkspaceCounts(
  db: RoomRelayDatabase,
  profile: UserProfile,
): Promise<WorkspaceCounts> {
  const unread = await countUnreadNotifications(db, profile.id);

  if (profile.role === "student" || profile.status !== "active") {
    return { unread, toReview: 0, openIssues: 0 };
  }

  const scope = profile.role === "admin" ? "1 = 1" : "r.manager_id = ?";
  const parameters = profile.role === "admin" ? [] : [profile.id];
  const nowIso = new Date().toISOString();

  const toReview = (
    (await db
      .prepare(
        `SELECT count(*) AS count
         FROM bookings b
         JOIN rooms r ON r.id = b.room_id
         WHERE ${scope}
           AND b.status = 'pending'
           AND b.start_at > ?`,
      )
      .get([...parameters, nowIso])) as { count: number }
  ).count;

  const openIssues = (
    (await db
      .prepare(
        `SELECT count(*) AS count
         FROM incidents i
         JOIN bookings b ON b.id = i.booking_id
         JOIN rooms r ON r.id = b.room_id
         WHERE ${scope}
           AND i.status IN ('open', 'reviewing')`,
      )
      .get(parameters)) as { count: number }
  ).count;

  return { unread, toReview, openIssues };
}
