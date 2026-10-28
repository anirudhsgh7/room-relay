import type { UserProfile } from "@/lib/auth/service";
import type { RoomRelayDatabase } from "@/lib/db/client";
import type { CampusInterval } from "@/lib/time/campus-time";
import {
  checkRoomAvailability,
  roomCanBeRequestedBy,
} from "@/lib/rooms/availability";
import type {
  RoomAvailabilityCode,
  RoomDetail,
  RoomHours,
  RoomPolicy,
  RoomRequirement,
  RoomSummary,
} from "@/lib/rooms/types";
import type { RoomSearchFilters } from "@/lib/rooms/search";

interface RoomRow {
  id: string;
  code: string;
  name: string;
  building: string;
  location: string;
  capacity: number;
  facilities: string;
  policy_summary: string;
  status: string;
  requests_enabled: number | null;
  slot_interval_minutes: number | null;
  minimum_notice_minutes: number | null;
  maximum_duration_minutes: number | null;
  buffer_minutes: number | null;
}

interface RequirementRow {
  room_id: string;
  id: string;
  requirement_type: string;
  description: string;
  required: number;
  verification: string | null;
  expires_at: string | null;
}

interface HoursRow {
  weekday: number;
  opens_at: string;
  closes_at: string;
  effective_from: string;
  effective_until: string | null;
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function policyFromRow(row: RoomRow): RoomPolicy {
  return {
    requestsEnabled: row.requests_enabled === 1,
    slotIntervalMinutes: row.slot_interval_minutes ?? 30,
    minimumNoticeMinutes: row.minimum_notice_minutes ?? 30,
    maximumDurationMinutes: row.maximum_duration_minutes ?? 240,
    bufferMinutes: row.buffer_minutes ?? 0,
  };
}

function availabilityFor(
  db: RoomRelayDatabase,
  row: RoomRow,
  interval: CampusInterval | null,
): RoomAvailabilityCode | null {
  if (row.status !== "active") {
    return "not_requestable";
  }

  if (row.requests_enabled !== 1) {
    return "not_requestable";
  }

  if (!interval) {
    return null;
  }

  const slot = row.slot_interval_minutes ?? 30;
  const maximumDuration = row.maximum_duration_minutes ?? 240;

  if (
    interval.startMinutes % slot !== 0 ||
    interval.endMinutes % slot !== 0 ||
    interval.durationMinutes > maximumDuration
  ) {
    return "invalid_time";
  }

  return checkRoomAvailability(db, {
    roomId: row.id,
    interval,
    bufferMinutes: row.buffer_minutes ?? 0,
  }).code;
}

function baseSummary(
  db: RoomRelayDatabase,
  row: RoomRow,
  interval: CampusInterval | null,
  requirements: RoomRequirement[],
): RoomSummary {
  const policy = policyFromRow(row);

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    building: row.building,
    location: row.location,
    capacity: row.capacity,
    facilities: parseStringArray(row.facilities),
    policySummary: row.policy_summary,
    policy,
    availability: availabilityFor(db, row, interval),
    requiredRequirementCount: requirements.filter(
      (requirement) => requirement.required,
    ).length,
    hasUnverifiedRequiredRequirement: requirements.some(
      (requirement) =>
        requirement.required &&
        requirement.verification !== "verified" &&
        requirement.verification !== null,
    ),
  };
}

function requirementVerification(
  row: RequirementRow,
  now: string,
): RoomRequirement["verification"] {
  if (row.verification === "verified") {
    return row.expires_at && row.expires_at <= now ? "expired" : "verified";
  }

  if (row.verification === "expired") {
    return "expired";
  }

  if (row.verification === "unverified" || row.verification === null) {
    return "unverified";
  }

  return null;
}

function loadRequirements(
  db: RoomRelayDatabase,
  roomIds: string[],
  profile: UserProfile,
): Map<string, RoomRequirement[]> {
  const result = new Map<string, RoomRequirement[]>();

  if (roomIds.length === 0) {
    return result;
  }

  const placeholders = roomIds.map(() => "?").join(", ");
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT
         er.room_id,
         er.id,
         er.requirement_type,
         er.description,
         er.required,
         pe.status AS verification,
         pe.expires_at
       FROM eligibility_requirements er
       LEFT JOIN profile_eligibility pe
         ON pe.requirement_id = er.id
        AND pe.profile_id = ?
       WHERE er.active = 1
         AND er.room_id IN (${placeholders})
       ORDER BY er.room_id, er.required DESC, er.description`,
    )
    .all(profile.role === "student" ? profile.id : null, ...roomIds) as RequirementRow[];

  for (const row of rows) {
    const list = result.get(row.room_id) ?? [];
    list.push({
      id: row.id,
      requirementType: row.requirement_type,
      description: row.description,
      required: row.required === 1,
      verification:
        profile.role === "student" ? requirementVerification(row, now) : null,
    });
    result.set(row.room_id, list);
  }

  return result;
}

export function getCurrentRequirementsForProfile(
  db: RoomRelayDatabase,
  roomId: string,
  profileId: string,
): RoomRequirement[] {
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT
         er.room_id,
         er.id,
         er.requirement_type,
         er.description,
         er.required,
         pe.status AS verification,
         pe.expires_at
       FROM eligibility_requirements er
       LEFT JOIN profile_eligibility pe
         ON pe.requirement_id = er.id
        AND pe.profile_id = ?
       WHERE er.room_id = ?
         AND er.active = 1
       ORDER BY er.required DESC, er.description`,
    )
    .all(profileId, roomId) as RequirementRow[];

  return rows.map((row) => ({
    id: row.id,
    requirementType: row.requirement_type,
    description: row.description,
    required: row.required === 1,
    verification: requirementVerification(row, now),
  }));
}

export function getOutstandingMandatoryRequirements(
  db: RoomRelayDatabase,
  roomId: string,
  profileId: string,
): RoomRequirement[] {
  return getCurrentRequirementsForProfile(db, roomId, profileId).filter(
    (requirement) =>
      requirement.required && requirement.verification !== "verified",
  );
}

export function getRoomFilterOptions(db: RoomRelayDatabase): {
  buildings: string[];
  facilities: string[];
} {
  const rows = db
    .prepare(
      `SELECT building, facilities
       FROM rooms
       WHERE status = 'active'
       ORDER BY building, code`,
    )
    .all() as Array<{ building: string; facilities: string }>;

  const buildings = [...new Set(rows.map((row) => row.building))].sort((a, b) =>
    a.localeCompare(b),
  );
  const facilities = [
    ...new Set(
      rows.flatMap((row) => parseStringArray(row.facilities)),
    ),
  ].sort((a, b) => a.localeCompare(b));

  return { buildings, facilities };
}

export function searchRooms(
  db: RoomRelayDatabase,
  profile: UserProfile,
  filters: RoomSearchFilters,
  interval: CampusInterval | null,
): RoomSummary[] {
  const conditions = ["r.status = 'active'"];
  const parameters: Array<string | number> = [];

  if (filters.minCapacity !== null) {
    conditions.push("r.capacity >= ?");
    parameters.push(filters.minCapacity);
  }

  if (filters.building) {
    conditions.push("r.building = ? COLLATE NOCASE");
    parameters.push(filters.building);
  }

  for (const facility of filters.facilities) {
    conditions.push(
      "EXISTS (SELECT 1 FROM json_each(r.facilities) AS selected_facility WHERE selected_facility.value = ? COLLATE NOCASE)",
    );
    parameters.push(facility);
  }

  const rows = db
    .prepare(
      `SELECT
         r.id, r.code, r.name, r.building, r.location, r.capacity,
         r.facilities, r.policy_summary, r.status,
         policy.requests_enabled,
         policy.slot_interval_minutes,
         policy.minimum_notice_minutes,
         policy.maximum_duration_minutes,
         policy.buffer_minutes
       FROM rooms r
       LEFT JOIN room_booking_policies policy ON policy.room_id = r.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY r.capacity, r.building, r.code
       LIMIT 100`,
    )
    .all(...parameters) as RoomRow[];

  const requirements = loadRequirements(
    db,
    rows.map((row) => row.id),
    profile,
  );

  const summaries = rows.map((row) =>
    baseSummary(db, row, interval, requirements.get(row.id) ?? []),
  );

  if (interval) {
    summaries.sort((left, right) => {
      const leftAvailable = left.availability === "available" ? 0 : 1;
      const rightAvailable = right.availability === "available" ? 0 : 1;
      return (
        leftAvailable - rightAvailable ||
        left.capacity - right.capacity ||
        left.building.localeCompare(right.building) ||
        left.code.localeCompare(right.code)
      );
    });
  }

  return summaries;
}

export function getRoomDetail(
  db: RoomRelayDatabase,
  profile: UserProfile,
  code: string,
  interval: CampusInterval | null,
): RoomDetail | null {
  const row = db
    .prepare(
      `SELECT
         r.id, r.code, r.name, r.building, r.location, r.capacity,
         r.facilities, r.policy_summary, r.status,
         policy.requests_enabled,
         policy.slot_interval_minutes,
         policy.minimum_notice_minutes,
         policy.maximum_duration_minutes,
         policy.buffer_minutes
       FROM rooms r
       LEFT JOIN room_booking_policies policy ON policy.room_id = r.id
       WHERE r.code = ? COLLATE NOCASE
         AND r.status = 'active'`,
    )
    .get(code) as RoomRow | undefined;

  if (!row) {
    return null;
  }

  const requirements = loadRequirements(db, [row.id], profile).get(row.id) ?? [];
  const hours = db
    .prepare(
      `SELECT weekday, opens_at, closes_at, effective_from, effective_until
       FROM availability_rules
       WHERE room_id = ? AND active = 1
       ORDER BY weekday, opens_at`,
    )
    .all(row.id) as HoursRow[];

  return {
    ...baseSummary(db, row, interval, requirements),
    requirements,
    hours: hours.map<RoomHours>((rule) => ({
      weekday: rule.weekday,
      opensAt: rule.opens_at,
      closesAt: rule.closes_at,
      effectiveFrom: rule.effective_from,
      effectiveUntil: rule.effective_until,
    })),
  };
}

export function getRoomForRequest(
  db: RoomRelayDatabase,
  profile: UserProfile,
  code: string,
): RoomDetail | null {
  return getRoomDetail(db, profile, code, null);
}

export function canRequestRoom(profile: UserProfile, room: RoomDetail): boolean {
  return roomCanBeRequestedBy(profile, "active", room.policy.requestsEnabled);
}
