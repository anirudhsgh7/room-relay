import type { UserProfile } from "@/lib/auth/service";
import type { RoomRelayDatabase } from "@/lib/db/client";
import type { Role } from "@/lib/domain";

export interface AssignedRoom {
  code: string;
  name: string;
}

export interface FoundationSnapshot {
  activeRooms: number;
  totalRooms: number;
  migrationsApplied: number;
  assignedRooms: AssignedRoom[];
  managedPendingBookings: number | null;
  ownActiveBookings: number | null;
  ownActiveCredentials: number | null;
  institutionProfiles: number | null;
  institutionActiveProfiles: number | null;
  institutionCredentials: number | null;
  institutionPendingBookings: number | null;
}

function count(
  db: RoomRelayDatabase,
  sql: string,
  ...parameters: string[]
): number {
  const row = db.prepare(sql).get(...parameters) as { count: number };
  return row.count;
}

/**
 * Returns only fields that the signed-in role may see. This is intentionally a
 * narrow server-side projection rather than a generic table API.
 */
export function getFoundationSnapshot(
  db: RoomRelayDatabase,
  profile: UserProfile,
): FoundationSnapshot {
  const isAdmin = profile.role === "admin";
  const isManager = profile.role === "manager";

  const activeRooms = count(
    db,
    "SELECT count(*) AS count FROM rooms WHERE status = 'active'",
  );
  const totalRooms = count(db, "SELECT count(*) AS count FROM rooms");

  const assignedRooms = isManager
    ? (db
        .prepare(
          `SELECT code, name
           FROM rooms
           WHERE manager_id = ? AND status = 'active'
           ORDER BY code`,
        )
        .all(profile.id) as AssignedRoom[])
    : [];

  const managedPendingBookings = isManager
    ? count(
        db,
        `SELECT count(*) AS count
         FROM bookings b
         JOIN rooms r ON r.id = b.room_id
         WHERE r.manager_id = ? AND b.status = 'pending'`,
        profile.id,
      )
    : null;

  const ownActiveBookings =
    profile.role === "student"
      ? count(
          db,
          `SELECT count(*) AS count
           FROM bookings
           WHERE requester_id = ? AND status IN ('pending', 'approved', 'checked_in')`,
          profile.id,
        )
      : null;

  const ownActiveCredentials =
    profile.role === "student"
      ? count(
          db,
          "SELECT count(*) AS count FROM credentials WHERE user_id = ? AND active = 1",
          profile.id,
        )
      : null;

  return {
    activeRooms,
    totalRooms,
    migrationsApplied: count(
      db,
      "SELECT count(*) AS count FROM schema_migrations",
    ),
    assignedRooms,
    managedPendingBookings,
    ownActiveBookings,
    ownActiveCredentials,
    institutionProfiles: isAdmin
      ? count(db, "SELECT count(*) AS count FROM profiles")
      : null,
    institutionActiveProfiles: isAdmin
      ? count(
          db,
          "SELECT count(*) AS count FROM profiles WHERE status = 'active'",
        )
      : null,
    institutionCredentials: isAdmin
      ? count(db, "SELECT count(*) AS count FROM credentials")
      : null,
    institutionPendingBookings: isAdmin
      ? count(
          db,
          "SELECT count(*) AS count FROM bookings WHERE status = 'pending'",
        )
      : null,
  };
}

export function getRoleWorkspaceCopy(role: Role): {
  eyebrow: string;
  title: string;
  description: string;
} {
  switch (role) {
    case "student":
      return {
        eyebrow: "Student workspace",
        title: "Own the full room lifecycle.",
        description:
          "Discover rooms, follow manager decisions, simulate time-bound access, check out with a condition report, and follow any incident review through to resolution.",
      };
    case "manager":
      return {
        eyebrow: "Manager workspace",
        title: "Decisions, access, and incidents.",
        description:
          "Review requests for assigned rooms, inspect simulated access activity, and record incident review recommendations for human resolution.",
      };
    case "admin":
      return {
        eyebrow: "Administration workspace",
        title: "Institution review, end to end.",
        description:
          "Administrative visibility spans room requests, access activity, and final incident resolution across the institution.",
      };
  }
}
