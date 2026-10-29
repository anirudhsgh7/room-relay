import { demoAccounts } from "@/lib/demo-accounts";
import type { RoomRelayDatabase } from "@/lib/db/client";
import type { Role } from "@/lib/domain";
import { hashPassword } from "@/lib/auth/password";

export interface SeedSummary {
  profiles: number;
  rooms: number;
  availabilityRules: number;
  eligibilityRequirements: number;
  roomPolicies: number;
  profileEligibility: number;
  bookings: number;
  credentials: number;
  accessEvents: number;
  auditEvents: number;
  conditionReports: number;
  incidents: number;
}

interface SeedProfile {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  password: string;
  status: "active" | "suspended";
}

const inactiveProfile: SeedProfile = {
  id: "usr_jamie_cole",
  email: "inactive@roomrelay.demo",
  displayName: "Jamie Cole",
  role: "student",
  password: "demo-inactive-2026",
  status: "suspended",
};

const secondaryStudentProfile: SeedProfile = {
  id: "usr_noah_williams",
  email: "student2@roomrelay.demo",
  displayName: "Noah Williams",
  role: "student",
  password: "demo-student2-2026",
  status: "active",
};

const seedProfiles: SeedProfile[] = [
  ...demoAccounts.map((account) => ({
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    role: account.role,
    password: account.password,
    status: "active" as const,
  })),
  secondaryStudentProfile,
  inactiveProfile,
];

const seedRooms = [
  {
    id: "room_seminar_02",
    code: "SEM-02",
    name: "Seminar Room 02",
    building: "Hazelwood Hall",
    location: "Second floor, east wing",
    capacity: 18,
    facilities: ["Projector", "Whiteboard", "Hybrid meeting kit"],
    policy:
      "Student clubs and course groups. Return the furniture to boardroom layout.",
    managerId: "usr_marcus_webb",
    status: "active",
  },
  {
    id: "room_media_studio",
    code: "MED-01",
    name: "Media Studio 01",
    building: "Arts Annex",
    location: "Ground floor",
    capacity: 8,
    facilities: ["Camera rig", "Green screen", "Acoustic panels"],
    policy:
      "Equipment induction required before the first booking. No food or drink.",
    managerId: "usr_priya_nair",
    status: "active",
  },
  {
    id: "room_classroom_14",
    code: "NEW-14",
    name: "Classroom 14",
    building: "Newton Building",
    location: "First floor",
    capacity: 40,
    facilities: ["Projector", "Hearing loop", "Step-free access"],
    policy:
      "Teaching timetable takes priority. Student bookings after 18:00 only.",
    managerId: "usr_marcus_webb",
    status: "active",
  },
  {
    id: "room_library_quiet",
    code: "LIB-03",
    name: "Quiet Study 03",
    building: "Central Library",
    location: "Level 2",
    capacity: 4,
    facilities: ["Whiteboard", "Power outlets"],
    policy: "Quiet use only. Maximum two-hour sessions.",
    managerId: "usr_priya_nair",
    status: "active",
  },
  {
    id: "room_archive_lab",
    code: "ARC-B1",
    name: "Archive Lab",
    building: "Old Registry",
    location: "Basement",
    capacity: 10,
    facilities: ["Archive shelving", "Worktables"],
    policy:
      "Inactive while environmental controls are being reviewed.",
    managerId: "usr_marcus_webb",
    status: "inactive",
  },
] as const;

function atUtcDate(
  reference: Date,
  dayOffset: number,
  hour: number,
  minute = 0,
): string {
  const value = new Date(reference);
  value.setUTCDate(value.getUTCDate() + dayOffset);
  value.setUTCHours(hour, minute, 0, 0);
  return value.toISOString();
}

function atNextWeekdayUtcDate(
  reference: Date,
  dayOffset: number,
  hour: number,
  minute = 0,
): string {
  const value = new Date(reference);
  value.setUTCDate(value.getUTCDate() + dayOffset);
  value.setUTCHours(hour, minute, 0, 0);

  while (value.getUTCDay() === 0 || value.getUTCDay() === 6) {
    value.setUTCDate(value.getUTCDate() + 1);
  }

  return value.toISOString();
}

async function countRows(
  db: RoomRelayDatabase,
  table: string,
): Promise<number> {
  const row = (await db
    .prepare(`SELECT count(*) AS count FROM ${table}`)
    .get()) as {
    count: number;
  };
  return row.count;
}

export async function seedDatabase(
  db: RoomRelayDatabase,
  options: { now?: Date } = {},
): Promise<SeedSummary> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const hashedProfiles = await Promise.all(
    seedProfiles.map(async (profile) => ({
      ...profile,
      passwordHash: await hashPassword(profile.password),
    })),
  );

  const completedStart = atUtcDate(now, -5, 17);
  const completedEnd = atUtcDate(now, -5, 18, 30);
  const approvedStart = atNextWeekdayUtcDate(now, 1, 16);
  const approvedEnd = atNextWeekdayUtcDate(now, 1, 17, 30);
  const pendingStart = atNextWeekdayUtcDate(now, 2, 15);
  const pendingEnd = atNextWeekdayUtcDate(now, 2, 16, 30);
  const pendingSeminarStart = atNextWeekdayUtcDate(now, 4, 13);
  const pendingSeminarEnd = atNextWeekdayUtcDate(now, 4, 14, 30);
  const rejectedStart = atUtcDate(now, -2, 18);
  const rejectedEnd = atUtcDate(now, -2, 19, 30);
  const cancelledStart = atUtcDate(now, 3, 11);
  const cancelledEnd = atUtcDate(now, 3, 12);
  const activeAccessStart = new Date(
    now.getTime() - 15 * 60 * 1000,
  ).toISOString();
  const activeAccessEnd = new Date(
    now.getTime() + 45 * 60 * 1000,
  ).toISOString();
  const incidentOpenStart = atUtcDate(now, -6, 10);
  const incidentOpenEnd = atUtcDate(now, -6, 11);
  const incidentReviewStart = atUtcDate(now, -7, 14);
  const incidentReviewEnd = atUtcDate(now, -7, 15);

  const seed = db.transaction(async () => {
    const upsertProfile = db.prepare(`
      INSERT INTO profiles (
        id, email, display_name, role, status, password_hash, created_at, updated_at
      ) VALUES (
        @id, @email, @display_name, @role, @status, @password_hash, @now, @now
      )
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email,
        display_name = excluded.display_name,
        role = excluded.role,
        status = excluded.status,
        password_hash = excluded.password_hash,
        updated_at = excluded.updated_at
    `);

    for (const profile of hashedProfiles) {
      await upsertProfile.run({
        id: profile.id,
        email: profile.email,
        display_name: profile.displayName,
        role: profile.role,
        status: profile.status,
        password_hash: profile.passwordHash,
        now: nowIso,
      });
    }

    const upsertRoom = db.prepare(`
      INSERT INTO rooms (
        id, code, name, building, location, capacity, facilities,
        policy_summary, manager_id, status, created_at, updated_at
      ) VALUES (
        @id, @code, @name, @building, @location, @capacity, @facilities,
        @policy_summary, @manager_id, @status, @now, @now
      )
      ON CONFLICT(id) DO NOTHING
    `);

    // Rooms, hours, requirements, and booking policies are administrator-owned
    // once they exist. Seeding only creates them for rooms that are new in this
    // run, so `npm start` (which re-runs setup) never overwrites admin edits.
    const newlySeededRoomIds = new Set<string>();

    for (const room of seedRooms) {
      const inserted = await upsertRoom.run({
        id: room.id,
        code: room.code,
        name: room.name,
        building: room.building,
        location: room.location,
        capacity: room.capacity,
        facilities: JSON.stringify(room.facilities),
        policy_summary: room.policy,
        manager_id: room.managerId,
        status: room.status,
        now: nowIso,
      });

      if (inserted.changes === 1) {
        newlySeededRoomIds.add(room.id);
      }
    }

    const upsertAvailability = db.prepare(`
      INSERT INTO availability_rules (
        id, room_id, weekday, opens_at, closes_at, effective_from,
        effective_until, active, created_at, updated_at
      ) VALUES (
        @id, @room_id, @weekday, @opens_at, @closes_at, @effective_from,
        NULL, 1, @now, @now
      )
      ON CONFLICT(id) DO NOTHING
    `);

    const roomHours = [
      { roomId: "room_seminar_02", opens: "08:00", closes: "22:00" },
      { roomId: "room_media_studio", opens: "09:00", closes: "21:00" },
      { roomId: "room_classroom_14", opens: "08:00", closes: "22:00" },
      { roomId: "room_library_quiet", opens: "08:00", closes: "20:00" },
    ];

    for (const hours of roomHours) {
      if (!newlySeededRoomIds.has(hours.roomId)) {
        continue;
      }

      for (let weekday = 1; weekday <= 5; weekday += 1) {
        await upsertAvailability.run({
          id: `${hours.roomId}_weekday_${weekday}`,
          room_id: hours.roomId,
          weekday,
          opens_at: hours.opens,
          closes_at: hours.closes,
          effective_from: "2025-01-01",
          now: nowIso,
        });
      }
    }

    const upsertRequirement = db.prepare(`
      INSERT INTO eligibility_requirements (
        id, room_id, requirement_type, description, required, active,
        created_at, updated_at
      ) VALUES (
        @id, @room_id, @requirement_type, @description, @required, 1, @now, @now
      )
      ON CONFLICT(id) DO NOTHING
    `);

    await upsertRequirement.run({
      id: "req_seminar_club_briefing",
      room_id: "room_seminar_02",
      requirement_type: "club_safety_briefing",
      description:
        "Demo policy: club safety briefing required before the first booking.",
      required: 1,
      now: nowIso,
    });
    await upsertRequirement.run({
      id: "req_media_equipment_induction",
      room_id: "room_media_studio",
      requirement_type: "equipment_induction",
      description:
        "Demo policy: complete a media equipment induction before recording.",
      required: 1,
      now: nowIso,
    });

    const upsertPolicy = db.prepare(`
      INSERT INTO room_booking_policies (
        room_id, requests_enabled, slot_interval_minutes,
        minimum_notice_minutes, maximum_duration_minutes, buffer_minutes,
        updated_at
      ) VALUES (
        @room_id, @requests_enabled, 30, 30, @maximum_duration_minutes, 0, @now
      )
      ON CONFLICT(room_id) DO NOTHING
    `);

    const roomPolicies = [
      {
        room_id: "room_seminar_02",
        requests_enabled: 1,
        maximum_duration_minutes: 240,
      },
      {
        room_id: "room_media_studio",
        requests_enabled: 1,
        maximum_duration_minutes: 180,
      },
      {
        room_id: "room_classroom_14",
        requests_enabled: 1,
        maximum_duration_minutes: 240,
      },
      {
        room_id: "room_library_quiet",
        requests_enabled: 1,
        maximum_duration_minutes: 120,
      },
      {
        room_id: "room_archive_lab",
        requests_enabled: 0,
        maximum_duration_minutes: 120,
      },
    ] as const;

    for (const policy of roomPolicies) {
      if (newlySeededRoomIds.has(policy.room_id)) {
        await upsertPolicy.run({ ...policy, now: nowIso });
      }
    }

    const upsertProfileEligibility = db.prepare(`
      INSERT INTO profile_eligibility (
        id, profile_id, requirement_id, status, verified_by, verified_at,
        expires_at, created_at, updated_at
      ) VALUES (
        @id, @profile_id, @requirement_id, @status, @verified_by, @verified_at,
        NULL, @now, @now
      )
      ON CONFLICT(profile_id, requirement_id) DO UPDATE SET
        status = excluded.status,
        verified_by = excluded.verified_by,
        verified_at = excluded.verified_at,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `);

    await upsertProfileEligibility.run({
      id: "elig_amelia_seminar_briefing",
      profile_id: "usr_amelia_chen",
      requirement_id: "req_seminar_club_briefing",
      status: "verified",
      verified_by: "usr_marcus_webb",
      verified_at: new Date(
        now.getTime() - 10 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      now: nowIso,
    });
    await upsertProfileEligibility.run({
      id: "elig_amelia_media_induction",
      profile_id: "usr_amelia_chen",
      requirement_id: "req_media_equipment_induction",
      status: "unverified",
      verified_by: null,
      verified_at: null,
      now: nowIso,
    });

    const insertBooking = db.prepare(`
      INSERT INTO bookings (
        id, room_id, requester_id, purpose, group_name, expected_attendance,
        start_at, end_at, status, decision_reason, decided_by, decided_at,
        created_at, updated_at, submission_key, request_payload_hash,
        eligibility_snapshot_json, cancelled_by, cancelled_at,
        cancellation_reason, eligibility_override_reason,
        eligibility_override_requirement_ids_json, checked_in_at,
        checked_out_at, closed_at, closure_reason
      ) VALUES (
        @id, @room_id, @requester_id, @purpose, @group_name, @expected_attendance,
        @start_at, @end_at, @status, @decision_reason, @decided_by, @decided_at,
        @created_at, @updated_at, NULL, NULL, @eligibility_snapshot_json,
        @cancelled_by, @cancelled_at, @cancellation_reason,
        NULL, NULL, @checked_in_at, @checked_out_at, @closed_at, @closure_reason
      )
      ON CONFLICT(id) DO NOTHING
    `);

    const bookings = [
      {
        id: "booking_approved_seminar",
        room_id: "room_seminar_02",
        requester_id: "usr_amelia_chen",
        purpose: "Robotics club weekly build session",
        group_name: "Robotics Club",
        expected_attendance: 14,
        start_at: approvedStart,
        end_at: approvedEnd,
        status: "approved",
        decision_reason:
          "Club safety briefing verified. The requested window is available.",
        decided_by: "usr_marcus_webb",
        decided_at: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(),
        created_at: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "booking_pending_media",
        room_id: "room_media_studio",
        requester_id: "usr_amelia_chen",
        purpose: "Record the first episode of the campus radio show",
        group_name: "Campus Radio",
        expected_attendance: 6,
        start_at: pendingStart,
        end_at: pendingEnd,
        status: "pending",
        decision_reason: null,
        decided_by: null,
        decided_at: null,
        created_at: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "booking_pending_media_overlap",
        room_id: "room_media_studio",
        requester_id: "usr_noah_williams",
        purpose: "Record a short documentary interview",
        group_name: "Film Society",
        expected_attendance: 5,
        start_at: pendingStart,
        end_at: pendingEnd,
        status: "pending",
        decision_reason: null,
        decided_by: null,
        decided_at: null,
        created_at: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "booking_pending_seminar",
        room_id: "room_seminar_02",
        requester_id: "usr_amelia_chen",
        purpose: "Plan the next robotics outreach workshop",
        group_name: "Robotics Club",
        expected_attendance: 10,
        start_at: pendingSeminarStart,
        end_at: pendingSeminarEnd,
        status: "pending",
        decision_reason: null,
        decided_by: null,
        decided_at: null,
        created_at: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "booking_demo_active_classroom",
        room_id: "room_classroom_14",
        requester_id: "usr_amelia_chen",
        purpose: "Live simulated access demo",
        group_name: "Robotics Club",
        expected_attendance: 8,
        start_at: activeAccessStart,
        end_at: activeAccessEnd,
        status: "approved",
        decision_reason:
          "Demo access window approved for the live simulation.",
        decided_by: "usr_marcus_webb",
        decided_at: new Date(
          now.getTime() - 60 * 60 * 1000,
        ).toISOString(),
        created_at: new Date(
          now.getTime() - 2 * 60 * 60 * 1000,
        ).toISOString(),
        updated_at: new Date(
          now.getTime() - 60 * 60 * 1000,
        ).toISOString(),
      },
      {
        id: "booking_rejected_classroom",
        room_id: "room_classroom_14",
        requester_id: "usr_amelia_chen",
        purpose: "Revision session for first-year design students",
        group_name: "Design Society",
        expected_attendance: 30,
        start_at: rejectedStart,
        end_at: rejectedEnd,
        status: "rejected",
        decision_reason:
          "The room is reserved for an evening examination during this window.",
        decided_by: "usr_marcus_webb",
        decided_at: new Date(
          now.getTime() - 3 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        created_at: new Date(
          now.getTime() - 4 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        updated_at: new Date(
          now.getTime() - 3 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
      {
        id: "booking_cancelled_library",
        room_id: "room_library_quiet",
        requester_id: "usr_amelia_chen",
        purpose: "Pair-programming session",
        group_name: "Computing Society",
        expected_attendance: 4,
        start_at: cancelledStart,
        end_at: cancelledEnd,
        status: "cancelled",
        decision_reason: null,
        decided_by: null,
        decided_at: null,
        created_at: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(),
        updated_at: nowIso,
      },
      {
        id: "booking_completed_seminar",
        room_id: "room_seminar_02",
        requester_id: "usr_amelia_chen",
        purpose: "Robotics prototype review",
        group_name: "Robotics Club",
        expected_attendance: 12,
        start_at: completedStart,
        end_at: completedEnd,
        status: "completed",
        decision_reason:
          "Club safety briefing verified. The requested window is available.",
        decided_by: "usr_marcus_webb",
        decided_at: new Date(
          now.getTime() - 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        created_at: new Date(
          now.getTime() - 8 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        updated_at: new Date(
          now.getTime() - 5 * 24 * 60 * 60 * 1000 + 90 * 60 * 1000,
        ).toISOString(),
      },
      {
        id: "booking_incident_open",
        room_id: "room_media_studio",
        requester_id: "usr_amelia_chen",
        purpose: "Podcast equipment handover demo",
        group_name: "Campus Radio",
        expected_attendance: 5,
        start_at: incidentOpenStart,
        end_at: incidentOpenEnd,
        status: "incident",
        decision_reason:
          "Equipment induction verified for the demo booking.",
        decided_by: "usr_priya_nair",
        decided_at: new Date(
          now.getTime() - 8 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        created_at: new Date(
          now.getTime() - 9 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        updated_at: new Date(
          now.getTime() - 6 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
      {
        id: "booking_incident_reviewing",
        room_id: "room_library_quiet",
        requester_id: "usr_noah_williams",
        purpose: "Evening study room handover demo",
        group_name: "Film Society",
        expected_attendance: 3,
        start_at: incidentReviewStart,
        end_at: incidentReviewEnd,
        status: "incident",
        decision_reason:
          "Quiet-study request accepted for the demo booking.",
        decided_by: "usr_priya_nair",
        decided_at: new Date(
          now.getTime() - 9 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        created_at: new Date(
          now.getTime() - 10 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        updated_at: new Date(
          now.getTime() - 6 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
    ] as const;

    const mediaEligibilitySnapshot = JSON.stringify([
      {
        requirementId: "req_media_equipment_induction",
        description:
          "Demo policy: complete a media equipment induction before recording.",
        required: true,
        status: "unverified",
      },
    ]);
    const seminarEligibilitySnapshot = JSON.stringify([
      {
        requirementId: "req_seminar_club_briefing",
        description:
          "Demo policy: club safety briefing required before the first booking.",
        required: true,
        status: "verified",
      },
    ]);

    // SQLite runs BEFORE INSERT triggers even for rows that ON CONFLICT DO
    // NOTHING would then skip. Once an administrator has changed a room (for
    // example reassigned its manager), re-inserting a fixture would fail the
    // decision-metadata trigger, so existing fixtures are skipped up front.
    const bookingExists = db.prepare("SELECT 1 FROM bookings WHERE id = ?");

    for (const booking of bookings) {
      if (await bookingExists.get(booking.id)) {
        continue;
      }

      const isCancelled = booking.id === "booking_cancelled_library";
      const completed = booking.id === "booking_completed_seminar";
      const openIncident = booking.id === "booking_incident_open";
      const reviewIncident = booking.id === "booking_incident_reviewing";

      await insertBooking.run({
        ...booking,
        eligibility_snapshot_json:
          booking.id === "booking_pending_media" ||
          booking.id === "booking_pending_media_overlap"
            ? mediaEligibilitySnapshot
            : booking.id === "booking_pending_seminar"
              ? seminarEligibilitySnapshot
              : null,
        cancelled_by: isCancelled ? "usr_amelia_chen" : null,
        cancelled_at: isCancelled ? nowIso : null,
        cancellation_reason: isCancelled
          ? "Demo fixture: the group schedule changed."
          : null,
        checked_in_at: completed
          ? new Date(
              new Date(completedStart).getTime() + 5 * 60 * 1000,
            ).toISOString()
          : openIncident
            ? new Date(
                new Date(incidentOpenStart).getTime() + 5 * 60 * 1000,
              ).toISOString()
            : reviewIncident
              ? new Date(
                  new Date(incidentReviewStart).getTime() + 5 * 60 * 1000,
                ).toISOString()
              : null,
        checked_out_at: completed
          ? new Date(
              new Date(completedEnd).getTime() + 15 * 60 * 1000,
            ).toISOString()
          : openIncident
            ? new Date(
                new Date(incidentOpenEnd).getTime() + 10 * 60 * 1000,
              ).toISOString()
            : reviewIncident
              ? new Date(
                  new Date(incidentReviewEnd).getTime() + 10 * 60 * 1000,
                ).toISOString()
              : null,
        closed_at: completed
          ? new Date(
              new Date(completedEnd).getTime() + 15 * 60 * 1000,
            ).toISOString()
          : null,
        closure_reason: completed
          ? "left_as_found"
          : openIncident || reviewIncident
            ? "issue_found"
            : null,
      });
    }

    const upsertCredential = db.prepare(`
      INSERT INTO credentials (
        id, user_id, credential_ref, credential_type, active, revoked_at,
        created_at, updated_at
      ) VALUES (
        @id, @user_id, @credential_ref, @credential_type, @active, @revoked_at,
        @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        credential_ref = excluded.credential_ref,
        credential_type = excluded.credential_type,
        active = excluded.active,
        revoked_at = excluded.revoked_at,
        updated_at = excluded.updated_at
    `);

    const credentials = [
      {
        id: "cred_amelia_active",
        user_id: "usr_amelia_chen",
        credential_ref: "demo-tag-amelia-014",
        credential_type: "nfc_uid",
        active: 1,
        revoked_at: null,
        created_at: new Date(
          now.getTime() - 60 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        updated_at: nowIso,
      },
      {
        id: "cred_amelia_revoked",
        user_id: "usr_amelia_chen",
        credential_ref: "demo-tag-amelia-old-007",
        credential_type: "nfc_uid",
        active: 0,
        revoked_at: new Date(
          now.getTime() - 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        created_at: new Date(
          now.getTime() - 90 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        updated_at: new Date(
          now.getTime() - 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
      {
        id: "cred_noah_active",
        user_id: "usr_noah_williams",
        credential_ref: "demo-tag-noah-018",
        credential_type: "nfc_uid",
        active: 1,
        revoked_at: null,
        created_at: new Date(
          now.getTime() - 60 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        updated_at: nowIso,
      },
      {
        id: "cred_marcus_active",
        user_id: "usr_marcus_webb",
        credential_ref: "demo-tag-marcus-021",
        credential_type: "nfc_uid",
        active: 1,
        revoked_at: null,
        created_at: new Date(
          now.getTime() - 60 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        updated_at: nowIso,
      },
      {
        id: "cred_priya_active",
        user_id: "usr_priya_nair",
        credential_ref: "demo-tag-priya-035",
        credential_type: "nfc_uid",
        active: 1,
        revoked_at: null,
        created_at: new Date(
          now.getTime() - 60 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        updated_at: nowIso,
      },
      {
        id: "cred_rowan_active",
        user_id: "usr_rowan_ellis",
        credential_ref: "demo-tag-rowan-050",
        credential_type: "nfc_uid",
        active: 1,
        revoked_at: null,
        created_at: new Date(
          now.getTime() - 60 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        updated_at: nowIso,
      },
    ] as const;

    for (const credential of credentials) {
      await upsertCredential.run(credential);
    }

    const insertAccessEvent = db.prepare(`
      INSERT INTO access_events (
        id, credential_id, attempted_credential_ref, room_id, occurred_at,
        result, reason_code, source, correlation_id, created_at,
        actor_id, booking_id, reader_id, request_hash
      ) VALUES (
        @id, @credential_id, @attempted_credential_ref, @room_id, @occurred_at,
        @result, @reason_code, 'seed', @correlation_id, @created_at,
        @actor_id, @booking_id, 'reader-simulator-01', @request_hash
      )
      ON CONFLICT(id) DO NOTHING
    `);

    await insertAccessEvent.run({
      id: "access_completed_allowed",
      credential_id: "cred_amelia_active",
      attempted_credential_ref: "demo-tag-amelia-014",
      room_id: "room_seminar_02",
      occurred_at: new Date(
        new Date(completedStart).getTime() + 5 * 60 * 1000,
      ).toISOString(),
      result: "allowed",
      reason_code: "WITHIN_APPROVED_WINDOW",
      correlation_id: "seed-access-allowed-001",
      created_at: nowIso,
      actor_id: "usr_amelia_chen",
      booking_id: "booking_completed_seminar",
      request_hash: "seed-access-hash-allowed",
    });

    await insertAccessEvent.run({
      id: "access_revoked_denied",
      credential_id: "cred_amelia_revoked",
      attempted_credential_ref: "demo-tag-amelia-old-007",
      room_id: "room_seminar_02",
      occurred_at: new Date(
        new Date(completedStart).getTime() + 10 * 60 * 1000,
      ).toISOString(),
      result: "denied",
      reason_code: "CREDENTIAL_REVOKED",
      correlation_id: "seed-access-denied-001",
      created_at: nowIso,
      actor_id: "usr_amelia_chen",
      booking_id: null,
      request_hash: "seed-access-hash-revoked",
    });

    await insertAccessEvent.run({
      id: "access_unknown_denied",
      credential_id: null,
      attempted_credential_ref: "demo-tag-unmapped-999",
      room_id: "room_media_studio",
      occurred_at: new Date(
        now.getTime() - 24 * 60 * 60 * 1000,
      ).toISOString(),
      result: "denied",
      reason_code: "UNKNOWN_CREDENTIAL",
      correlation_id: "seed-access-unknown-001",
      created_at: nowIso,
      actor_id: null,
      booking_id: null,
      request_hash: "seed-access-hash-unknown",
    });

    const insertConditionReport = db.prepare(`
      INSERT INTO condition_reports (
        id, booking_id, stage, condition_state, notes, submitted_by, created_at
      ) VALUES (
        @id, @booking_id, @stage, @condition_state, @notes, @submitted_by,
        @created_at
      )
      ON CONFLICT(id) DO NOTHING
    `);

    const conditionReports = [
      {
        id: "condition_completed_after",
        booking_id: "booking_completed_seminar",
        stage: "after",
        condition_state: "left_as_found",
        notes:
          "Room left as found. Chairs reset; projector powered down; no damage reported.",
        submitted_by: "usr_amelia_chen",
        created_at: new Date(
          new Date(completedEnd).getTime() + 15 * 60 * 1000,
        ).toISOString(),
      },
      {
        id: "condition_incident_open_after",
        booking_id: "booking_incident_open",
        stage: "after",
        condition_state: "issue_found",
        notes:
          "Demo issue report: one microphone stand was missing from the equipment cupboard.",
        submitted_by: "usr_amelia_chen",
        created_at: new Date(
          new Date(incidentOpenEnd).getTime() + 10 * 60 * 1000,
        ).toISOString(),
      },
      {
        id: "condition_incident_review_after",
        booking_id: "booking_incident_reviewing",
        stage: "after",
        condition_state: "issue_found",
        notes:
          "Demo issue report: the desk lamp was not working at the end of the session.",
        submitted_by: "usr_noah_williams",
        created_at: new Date(
          new Date(incidentReviewEnd).getTime() + 10 * 60 * 1000,
        ).toISOString(),
      },
    ] as const;

    for (const report of conditionReports) {
      await insertConditionReport.run(report);
    }

    const insertIncident = db.prepare(`
      INSERT INTO incidents (
        id, booking_id, category, description, status, reporter_id,
        reviewer_id, resolution_note, created_at, updated_at,
        manager_reviewed_by, manager_reviewed_at, manager_review_note,
        resolved_at
      ) VALUES (
        @id, @booking_id, @category, @description, @status, @reporter_id,
        @reviewer_id, @resolution_note, @created_at, @updated_at,
        @manager_reviewed_by, @manager_reviewed_at, @manager_review_note,
        @resolved_at
      )
      ON CONFLICT(id) DO NOTHING
    `);

    await insertIncident.run({
      id: "incident_equipment_open",
      booking_id: "booking_incident_open",
      category: "equipment",
      description:
        "Demo issue: one microphone stand was missing from the equipment cupboard.",
      status: "open",
      reporter_id: "usr_amelia_chen",
      reviewer_id: null,
      resolution_note: null,
      created_at: new Date(
        new Date(incidentOpenEnd).getTime() + 10 * 60 * 1000,
      ).toISOString(),
      updated_at: new Date(
        new Date(incidentOpenEnd).getTime() + 10 * 60 * 1000,
      ).toISOString(),
      manager_reviewed_by: null,
      manager_reviewed_at: null,
      manager_review_note: null,
      resolved_at: null,
    });

    await insertIncident.run({
      id: "incident_light_reviewing",
      booking_id: "booking_incident_reviewing",
      category: "equipment",
      description:
        "Demo issue: the desk lamp was not working at the end of the session.",
      status: "reviewing",
      reporter_id: "usr_noah_williams",
      reviewer_id: null,
      resolution_note: null,
      created_at: new Date(
        new Date(incidentReviewEnd).getTime() + 10 * 60 * 1000,
      ).toISOString(),
      updated_at: new Date(
        new Date(incidentReviewEnd).getTime() + 2 * 60 * 60 * 1000,
      ).toISOString(),
      manager_reviewed_by: "usr_priya_nair",
      manager_reviewed_at: new Date(
        new Date(incidentReviewEnd).getTime() + 2 * 60 * 60 * 1000,
      ).toISOString(),
      manager_review_note:
        "Demo manager review: the lamp fault was confirmed and a replacement was requested.",
      resolved_at: null,
    });

    const insertAuditEvent = db.prepare(`
      INSERT INTO audit_events (
        id, actor_id, action, entity_type, entity_id, occurred_at,
        summary, correlation_id, metadata_json
      ) VALUES (
        @id, @actor_id, @action, @entity_type, @entity_id, @occurred_at,
        @summary, @correlation_id, @metadata_json
      )
      ON CONFLICT(id) DO NOTHING
    `);

    const auditEvents = [
      {
        id: "audit_pending_submitted",
        actor_id: "usr_amelia_chen",
        action: "booking.submitted",
        entity_type: "booking",
        entity_id: "booking_pending_media",
        occurred_at: new Date(
          now.getTime() - 6 * 60 * 60 * 1000,
        ).toISOString(),
        summary:
          "Amelia Chen submitted a booking request for Media Studio 01.",
        correlation_id: "seed-audit-001",
        metadata_json: JSON.stringify({ seeded: true }),
      },
      {
        id: "audit_completed_submitted",
        actor_id: "usr_amelia_chen",
        action: "booking.submitted",
        entity_type: "booking",
        entity_id: "booking_completed_seminar",
        occurred_at: new Date(
          now.getTime() - 8 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        summary:
          "Amelia Chen submitted a booking request for Seminar Room 02.",
        correlation_id: "seed-audit-010",
        metadata_json: JSON.stringify({ seeded: true }),
      },
      {
        id: "audit_completed_approved",
        actor_id: "usr_marcus_webb",
        action: "booking.approved",
        entity_type: "booking",
        entity_id: "booking_completed_seminar",
        occurred_at: new Date(
          now.getTime() - 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        summary:
          "Marcus Webb approved the completed Robotics Club demo booking.",
        correlation_id: "seed-audit-011",
        metadata_json: JSON.stringify({ seeded: true }),
      },
      {
        id: "audit_demo_access_approved",
        actor_id: "usr_marcus_webb",
        action: "booking.approved",
        entity_type: "booking",
        entity_id: "booking_demo_active_classroom",
        occurred_at: new Date(
          now.getTime() - 60 * 60 * 1000,
        ).toISOString(),
        summary:
          "Marcus Webb approved a demo access window for Classroom 14.",
        correlation_id: "seed-audit-009",
        metadata_json: JSON.stringify({
          seeded: true,
          demoAccessWindow: true,
        }),
      },
      {
        id: "audit_pending_overlap_submitted",
        actor_id: "usr_noah_williams",
        action: "booking.submitted",
        entity_type: "booking",
        entity_id: "booking_pending_media_overlap",
        occurred_at: new Date(
          now.getTime() - 5 * 60 * 60 * 1000,
        ).toISOString(),
        summary:
          "Noah Williams submitted a booking request for Media Studio 01.",
        correlation_id: "seed-audit-006",
        metadata_json: JSON.stringify({ seeded: true }),
      },
      {
        id: "audit_pending_seminar_submitted",
        actor_id: "usr_amelia_chen",
        action: "booking.submitted",
        entity_type: "booking",
        entity_id: "booking_pending_seminar",
        occurred_at: new Date(
          now.getTime() - 2 * 60 * 60 * 1000,
        ).toISOString(),
        summary:
          "Amelia Chen submitted a booking request for Seminar Room 02.",
        correlation_id: "seed-audit-007",
        metadata_json: JSON.stringify({ seeded: true }),
      },
      {
        id: "audit_cancelled_fixture",
        actor_id: "usr_amelia_chen",
        action: "booking.cancelled",
        entity_type: "booking",
        entity_id: "booking_cancelled_library",
        occurred_at: nowIso,
        summary:
          "Amelia Chen cancelled a demo booking request for Quiet Study 03.",
        correlation_id: "seed-audit-008",
        metadata_json: JSON.stringify({
          seeded: true,
          priorStatus: "pending",
          reason: "Demo fixture: the group schedule changed.",
        }),
      },
      {
        id: "audit_approved_decision",
        actor_id: "usr_marcus_webb",
        action: "booking.approved",
        entity_type: "booking",
        entity_id: "booking_approved_seminar",
        occurred_at: new Date(
          now.getTime() - 12 * 60 * 60 * 1000,
        ).toISOString(),
        summary:
          "Marcus Webb approved the Robotics Club request for Seminar Room 02.",
        correlation_id: "seed-audit-002",
        metadata_json: JSON.stringify({
          seeded: true,
          reason: "Club safety briefing verified.",
        }),
      },
      {
        id: "audit_rejected_decision",
        actor_id: "usr_marcus_webb",
        action: "booking.rejected",
        entity_type: "booking",
        entity_id: "booking_rejected_classroom",
        occurred_at: new Date(
          now.getTime() - 3 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        summary:
          "Marcus Webb rejected the Design Society request for Classroom 14.",
        correlation_id: "seed-audit-003",
        metadata_json: JSON.stringify({
          seeded: true,
          reason: "Evening examination reservation.",
        }),
      },
      {
        id: "audit_access_allowed",
        actor_id: null,
        action: "access.allowed",
        entity_type: "access_event",
        entity_id: "access_completed_allowed",
        occurred_at: new Date(
          new Date(completedStart).getTime() + 5 * 60 * 1000,
        ).toISOString(),
        summary:
          "Seeded access check allowed an active credential inside the approved window.",
        correlation_id: "seed-audit-004",
        metadata_json: JSON.stringify({ seeded: true, source: "seed" }),
      },
      {
        id: "audit_completed_booking",
        actor_id: "usr_amelia_chen",
        action: "booking.completed",
        entity_type: "booking",
        entity_id: "booking_completed_seminar",
        occurred_at: new Date(
          new Date(completedEnd).getTime() + 15 * 60 * 1000,
        ).toISOString(),
        summary:
          "Amelia Chen completed the demo booking after the post-use handover.",
        correlation_id: "seed-audit-012",
        metadata_json: JSON.stringify({ seeded: true }),
      },
      {
        id: "audit_condition_submitted",
        actor_id: "usr_amelia_chen",
        action: "condition.submitted",
        entity_type: "booking",
        entity_id: "booking_completed_seminar",
        occurred_at: new Date(
          new Date(completedEnd).getTime() + 15 * 60 * 1000,
        ).toISOString(),
        summary:
          "Amelia Chen recorded the post-use condition report for Seminar Room 02.",
        correlation_id: "seed-audit-005",
        metadata_json: JSON.stringify({ seeded: true, stage: "after" }),
      },
    ] as const;

    for (const event of auditEvents) {
      await insertAuditEvent.run(event);
    }
  });

  await seed.immediate();

  return {
    profiles: await countRows(db, "profiles"),
    rooms: await countRows(db, "rooms"),
    availabilityRules: await countRows(db, "availability_rules"),
    eligibilityRequirements: await countRows(db, "eligibility_requirements"),
    roomPolicies: await countRows(db, "room_booking_policies"),
    profileEligibility: await countRows(db, "profile_eligibility"),
    bookings: await countRows(db, "bookings"),
    credentials: await countRows(db, "credentials"),
    accessEvents: await countRows(db, "access_events"),
    auditEvents: await countRows(db, "audit_events"),
    conditionReports: await countRows(db, "condition_reports"),
    incidents: await countRows(db, "incidents"),
  };
}
