import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers";
import { runMigrations } from "@/lib/db/migrate";
import { seedDatabase } from "@/lib/db/seed";

const fixedNow = new Date("2026-10-28T12:00:00.000Z");

describe("database migrations and seed data", () => {
  let testDatabase: TestDatabase;

  beforeEach(() => {
    testDatabase = createTestDatabase();
  });

  afterEach(() => {
    testDatabase.cleanup();
  });

  it("applies migrations once and records the schema version", () => {
    const secondRun = runMigrations(testDatabase.db);
    const migrations = testDatabase.db
      .prepare("SELECT name FROM schema_migrations ORDER BY name")
      .all() as Array<{ name: string }>;

    expect(secondRun).toEqual([]);
    expect(migrations).toEqual([
      { name: "001_initial.sql" },
      { name: "002_phase2_requests.sql" },
      { name: "003_phase3_manager_review.sql" },
      { name: "004_phase4_access_policy.sql" },
      { name: "005_phase5_closeout.sql" },
      { name: "006_operations.sql" },
    ]);
  });

  it("creates the complete lifecycle schema with foreign keys enabled", () => {
    const tables = testDatabase.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const names = tables.map((table) => table.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "profiles",
        "rooms",
        "availability_rules",
        "eligibility_requirements",
        "profile_eligibility",
        "room_booking_policies",
        "bookings",
        "credentials",
        "access_events",
        "audit_events",
        "condition_reports",
        "incidents",
        "schema_migrations",
      ]),
    );
    expect(testDatabase.db.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("seeds the demo dataset idempotently", async () => {
    const first = await seedDatabase(testDatabase.db, { now: fixedNow });
    const second = await seedDatabase(testDatabase.db, { now: fixedNow });

    expect(second).toEqual(first);
    expect(first).toEqual({
      profiles: 6,
      rooms: 5,
      availabilityRules: 20,
      eligibilityRequirements: 2,
      roomPolicies: 5,
      profileEligibility: 2,
      bookings: 10,
      credentials: 6,
      accessEvents: 3,
      auditEvents: 12,
      conditionReports: 3,
      incidents: 2,
    });

    const roomWindows = testDatabase.db
      .prepare(
        `SELECT r.code, count(a.id) AS rule_count
         FROM rooms r
         LEFT JOIN availability_rules a ON a.room_id = r.id
         GROUP BY r.id
         ORDER BY r.code`,
      )
      .all() as Array<{ code: string; rule_count: number }>;

    expect(roomWindows).toEqual([
      { code: "ARC-B1", rule_count: 0 },
      { code: "LIB-03", rule_count: 5 },
      { code: "MED-01", rule_count: 5 },
      { code: "NEW-14", rule_count: 5 },
      { code: "SEM-02", rule_count: 5 },
    ]);
  });

  it("assigns the two manager accounts to different room portfolios", async () => {
    await seedDatabase(testDatabase.db, { now: fixedNow });

    const rooms = testDatabase.db
      .prepare(
        `SELECT r.code, p.email
         FROM rooms r
         JOIN profiles p ON p.id = r.manager_id
         ORDER BY r.code`,
      )
      .all() as Array<{ code: string; email: string }>;

    expect(rooms).toEqual([
      { code: "ARC-B1", email: "manager@roomrelay.demo" },
      { code: "LIB-03", email: "manager2@roomrelay.demo" },
      { code: "MED-01", email: "manager2@roomrelay.demo" },
      { code: "NEW-14", email: "manager@roomrelay.demo" },
      { code: "SEM-02", email: "manager@roomrelay.demo" },
    ]);
  });

  it("enforces role, ownership, and time constraints", async () => {
    await seedDatabase(testDatabase.db, { now: fixedNow });

    expect(() =>
      testDatabase.db
        .prepare("UPDATE profiles SET role = 'owner' WHERE id = 'usr_amelia_chen'")
        .run(),
    ).toThrow(/CHECK constraint failed/i);

    expect(() =>
      testDatabase.db
        .prepare(
          "UPDATE rooms SET manager_id = 'usr_amelia_chen' WHERE id = 'room_seminar_02'",
        )
        .run(),
    ).toThrow(/room manager must have the manager role/i);

    expect(() =>
      testDatabase.db
        .prepare(
          `INSERT INTO bookings (
             id, room_id, requester_id, purpose, expected_attendance,
             start_at, end_at, status, created_at, updated_at
           ) VALUES (
             'booking_invalid_time', 'room_seminar_02', 'usr_amelia_chen',
             'Invalid interval', 2, '2026-11-01T17:00:00.000Z',
             '2026-11-01T16:00:00.000Z', 'pending',
             '2026-10-28T12:00:00.000Z', '2026-10-28T12:00:00.000Z'
           )`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/i);
  });

  it("prevents overlapping confirmed bookings at the database boundary", async () => {
    await seedDatabase(testDatabase.db, { now: fixedNow });

    const approved = testDatabase.db
      .prepare(
        "SELECT start_at, end_at FROM bookings WHERE id = 'booking_approved_seminar'",
      )
      .get() as { start_at: string; end_at: string };

    expect(() =>
      testDatabase.db
        .prepare(
          `INSERT INTO bookings (
             id, room_id, requester_id, purpose, expected_attendance,
             start_at, end_at, status, created_at, updated_at,
             decided_by, decided_at, decision_reason
           ) VALUES (
             'booking_confirmed_overlap', 'room_seminar_02', 'usr_amelia_chen',
             'Overlapping confirmed booking', 2, ?, ?, 'approved',
             '2026-10-28T12:00:00.000Z', '2026-10-28T12:00:00.000Z',
             'usr_marcus_webb', '2026-10-28T12:00:00.000Z',
             'Test confirmed overlap metadata.'
           )`,
        )
        .run(approved.start_at, approved.end_at),
    ).toThrow(/CONFIRMED_BOOKING_OVERLAP/);

    const pending = testDatabase.db
      .prepare(
        `INSERT INTO bookings (
           id, room_id, requester_id, purpose, expected_attendance,
           start_at, end_at, status, created_at, updated_at
         ) VALUES (
           'booking_pending_to_approve', 'room_seminar_02', 'usr_amelia_chen',
           'Pending request in an approved slot', 2, ?, ?, 'pending',
           '2026-10-28T12:00:00.000Z', '2026-10-28T12:00:00.000Z'
         )`,
      )
      .run(approved.start_at, approved.end_at);

    expect(pending.changes).toBe(1);
    expect(() =>
      testDatabase.db
        .prepare(
          `UPDATE bookings
           SET status = 'approved',
               decided_by = 'usr_marcus_webb',
               decided_at = '2026-10-28T12:00:00.000Z',
               decision_reason = 'Test approval metadata.'
           WHERE id = 'booking_pending_to_approve'`,
        )
        .run(),
    ).toThrow(/CONFIRMED_BOOKING_OVERLAP/);

    testDatabase.db
      .prepare(
        "UPDATE room_booking_policies SET buffer_minutes = 15 WHERE room_id = 'room_seminar_02'",
      )
      .run();

    const insideBufferStart = new Date(
      Date.parse(approved.end_at) + 10 * 60_000,
    ).toISOString();
    const insideBufferEnd = new Date(
      Date.parse(approved.end_at) + 70 * 60_000,
    ).toISOString();

    expect(() =>
      testDatabase.db
        .prepare(
          `INSERT INTO bookings (
             id, room_id, requester_id, purpose, expected_attendance,
             start_at, end_at, status, created_at, updated_at,
             decided_by, decided_at, decision_reason
           ) VALUES (
             'booking_inside_buffer', 'room_seminar_02', 'usr_amelia_chen',
             'Booking inside room buffer', 2, ?, ?, 'approved',
             '2026-10-28T12:00:00.000Z', '2026-10-28T12:00:00.000Z',
             'usr_marcus_webb', '2026-10-28T12:00:00.000Z',
             'Test buffer overlap metadata.'
           )`,
        )
        .run(insideBufferStart, insideBufferEnd),
    ).toThrow(/CONFIRMED_BOOKING_OVERLAP/);
  });

  it("requires trusted decision and cancellation metadata at the database boundary", async () => {
    await seedDatabase(testDatabase.db, { now: fixedNow });

    expect(() =>
      testDatabase.db
        .prepare(
          "UPDATE bookings SET status = 'approved' WHERE id = 'booking_pending_media'",
        )
        .run(),
    ).toThrow(/INVALID_DECISION_METADATA/);

    expect(() =>
      testDatabase.db
        .prepare(
          `UPDATE bookings
           SET status = 'approved',
               decided_by = 'usr_priya_nair',
               decided_at = '2026-10-28T12:00:00.000Z',
               decision_reason = 'Unassigned manager attempted a decision.'
           WHERE id = 'booking_pending_seminar'`,
        )
        .run(),
    ).toThrow(/INVALID_DECISION_METADATA/);

    expect(() =>
      testDatabase.db
        .prepare(
          "UPDATE bookings SET status = 'cancelled' WHERE id = 'booking_pending_media'",
        )
        .run(),
    ).toThrow(/INVALID_CANCELLATION_METADATA/);
  });

  it("permits approved to checked_in but rejects unsupported later transitions", async () => {
    await seedDatabase(testDatabase.db, { now: fixedNow });

    expect(() =>
      testDatabase.db
        .prepare(
          "UPDATE bookings SET status = 'checked_in' WHERE id = 'booking_demo_active_classroom'",
        )
        .run(),
    ).not.toThrow();

    expect(() =>
      testDatabase.db
        .prepare(
          "UPDATE bookings SET status = 'completed' WHERE id = 'booking_demo_active_classroom'",
        )
        .run(),
    ).toThrow(
      /INVALID_BOOKING_TRANSITION|CHECKOUT_REPORT_REQUIRED|CHECKOUT_TIME_REQUIRED|CLOSE_TIME_REQUIRED/,
    );
  });

  it("keeps access and audit history append-only", async () => {
    await seedDatabase(testDatabase.db, { now: fixedNow });

    expect(() =>
      testDatabase.db
        .prepare(
          "UPDATE access_events SET reason_code = 'TAMPERED' WHERE id = 'access_completed_allowed'",
        )
        .run(),
    ).toThrow(/append-only/i);

    expect(() =>
      testDatabase.db
        .prepare("DELETE FROM access_events WHERE id = 'access_completed_allowed'")
        .run(),
    ).toThrow(/append-only/i);

    expect(() =>
      testDatabase.db
        .prepare(
          "UPDATE audit_events SET summary = 'Tampered history' WHERE id = 'audit_access_allowed'",
        )
        .run(),
    ).toThrow(/append-only/i);

    expect(() =>
      testDatabase.db
        .prepare("DELETE FROM audit_events WHERE id = 'audit_access_allowed'")
        .run(),
    ).toThrow(/append-only/i);
  });
});
