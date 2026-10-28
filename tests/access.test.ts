import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProfileById } from "@/lib/auth/service";
import {
  listAccessHistory,
  getAccessSimulatorData,
  parseAccessHistoryFilters,
} from "@/lib/access/queries";
import { simulateAccessCheck } from "@/lib/access/service";
import { clearRateLimitsForTests } from "@/lib/rate-limit";
import { createSeededTestDatabase } from "./helpers";

type SeededTestDatabase = Awaited<ReturnType<typeof createSeededTestDatabase>>;

const fixedNow = new Date("2026-10-28T12:00:00.000Z");

function eventNonce(): string {
  return randomUUID();
}

function count(
  testDatabase: SeededTestDatabase,
  table: "access_events" | "audit_events",
): number {
  return (
    testDatabase.db
      .prepare(`SELECT count(*) AS count FROM ${table}`)
      .get() as { count: number }
  ).count;
}

describe("time-bound access policy", () => {
  let testDatabase: SeededTestDatabase;
  let student: NonNullable<ReturnType<typeof getProfileById>>;
  let otherStudent: NonNullable<ReturnType<typeof getProfileById>>;
  let priya: NonNullable<ReturnType<typeof getProfileById>>;
  let admin: NonNullable<ReturnType<typeof getProfileById>>;

  beforeEach(async () => {
    testDatabase = await createSeededTestDatabase(fixedNow);
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    clearRateLimitsForTests();
    student = getProfileById(testDatabase.db, "usr_amelia_chen")!;
    otherStudent = getProfileById(testDatabase.db, "usr_noah_williams")!;
    priya = getProfileById(testDatabase.db, "usr_priya_nair")!;
    admin = getProfileById(testDatabase.db, "usr_rowan_ellis")!;
  });

  afterEach(() => {
    clearRateLimitsForTests();
    vi.useRealTimers();
    testDatabase.cleanup();
  });

  it("allows a valid own credential inside the active demo booking window", () => {
    const beforeAccessEvents = count(testDatabase, "access_events");
    const beforeAudit = count(testDatabase, "audit_events");
    const result = simulateAccessCheck(testDatabase.db, student, {
      credentialId: "cred_amelia_active",
      roomId: "room_classroom_14",
      eventNonce: eventNonce(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.response).toMatchObject({
      decision: "ALLOW",
      reasonCode: "ACCESS_ALLOWED",
      replayed: false,
    });
    expect(result.response.bookingId).toBe("booking_demo_active_classroom");
    expect(count(testDatabase, "access_events")).toBe(beforeAccessEvents + 1);
    expect(count(testDatabase, "audit_events")).toBe(beforeAudit + 1);

    const booking = testDatabase.db
      .prepare(
        "SELECT status FROM bookings WHERE id = 'booking_demo_active_classroom'",
      )
      .get() as { status: string };
    expect(booking.status).toBe("checked_in");

    const event = testDatabase.db
      .prepare(
        "SELECT actor_id, booking_id, result, reason_code, source FROM access_events WHERE id = ?",
      )
      .get(result.response.eventId) as {
      actor_id: string;
      booking_id: string;
      result: string;
      reason_code: string;
      source: string;
    };
    expect(event).toEqual({
      actor_id: "usr_amelia_chen",
      booking_id: "booking_demo_active_classroom",
      result: "allowed",
      reason_code: "ACCESS_ALLOWED",
      source: "simulator",
    });
  });

  it("is idempotent for the same actor, nonce, and request payload", () => {
    const nonce = eventNonce();
    const payload = {
      credentialId: "cred_amelia_active",
      roomId: "room_classroom_14",
      eventNonce: nonce,
    };
    const first = simulateAccessCheck(testDatabase.db, student, payload);
    const afterFirst = count(testDatabase, "access_events");
    const second = simulateAccessCheck(testDatabase.db, student, payload);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.response.replayed).toBe(false);
    expect(second.response.replayed).toBe(true);
    expect(second.response.eventId).toBe(first.response.eventId);
    expect(count(testDatabase, "access_events")).toBe(afterFirst);
  });

  it("rejects a nonce reused with a different request payload", () => {
    const nonce = eventNonce();
    simulateAccessCheck(testDatabase.db, student, {
      credentialId: "cred_amelia_active",
      roomId: "room_classroom_14",
      eventNonce: nonce,
    });

    const result = simulateAccessCheck(testDatabase.db, student, {
      credentialId: "cred_amelia_active",
      roomId: "room_seminar_02",
      eventNonce: nonce,
    });

    expect(result).toMatchObject({
      ok: false,
      httpStatus: 409,
      reasonCode: "REPLAYED_ATTEMPT",
    });
  });

  it("denies a revoked credential and leaves the booking approved", () => {
    const result = simulateAccessCheck(testDatabase.db, student, {
      credentialId: "cred_amelia_revoked",
      roomId: "room_classroom_14",
      eventNonce: eventNonce(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response).toMatchObject({
      decision: "DENY",
      reasonCode: "CREDENTIAL_REVOKED",
    });

    const booking = testDatabase.db
      .prepare(
        "SELECT status FROM bookings WHERE id = 'booking_demo_active_classroom'",
      )
      .get() as { status: string };
    expect(booking.status).toBe("approved");
  });

  it("denies an unknown or another user's credential without ownership disclosure", () => {
    const unknown = simulateAccessCheck(testDatabase.db, student, {
      credentialId: "cred_does_not_exist",
      roomId: "room_classroom_14",
      eventNonce: eventNonce(),
    });
    const notOwned = simulateAccessCheck(testDatabase.db, student, {
      credentialId: "cred_marcus_active",
      roomId: "room_classroom_14",
      eventNonce: eventNonce(),
    });

    expect(unknown.ok && unknown.response.reasonCode).toBe("UNKNOWN_CREDENTIAL");
    expect(notOwned.ok && notOwned.response.reasonCode).toBe(
      "CREDENTIAL_NOT_OWNED",
    );
    expect(JSON.stringify(notOwned)).not.toContain("Marcus");
  });

  it("denies a pending request as not approved", () => {
    const result = simulateAccessCheck(testDatabase.db, student, {
      credentialId: "cred_amelia_active",
      roomId: "room_media_studio",
      eventNonce: eventNonce(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response).toMatchObject({
      decision: "DENY",
      reasonCode: "BOOKING_NOT_APPROVED",
      bookingStatus: "pending",
    });
  });

  it("denies a cancelled booking with a safe no-approved reason", () => {
    const result = simulateAccessCheck(testDatabase.db, student, {
      credentialId: "cred_amelia_active",
      roomId: "room_library_quiet",
      eventNonce: eventNonce(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response).toMatchObject({
      decision: "DENY",
      reasonCode: "NO_APPROVED_BOOKING",
    });
  });

  it("denies a future approved booking outside its time window", () => {
    const result = simulateAccessCheck(testDatabase.db, student, {
      credentialId: "cred_amelia_active",
      roomId: "room_seminar_02",
      eventNonce: eventNonce(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response).toMatchObject({
      decision: "DENY",
      reasonCode: "OUTSIDE_BOOKING_WINDOW",
    });
  });

  it("denies inactive rooms", () => {
    const result = simulateAccessCheck(testDatabase.db, student, {
      credentialId: "cred_amelia_active",
      roomId: "room_archive_lab",
      eventNonce: eventNonce(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response).toMatchObject({
      decision: "DENY",
      reasonCode: "ROOM_INACTIVE",
    });
  });

  it("denies a manager or admin without a matching booking", () => {
    const managerResult = simulateAccessCheck(testDatabase.db, priya, {
      credentialId: "cred_priya_active",
      roomId: "room_classroom_14",
      eventNonce: eventNonce(),
    });
    const adminResult = simulateAccessCheck(testDatabase.db, admin, {
      credentialId: "cred_rowan_active",
      roomId: "room_classroom_14",
      eventNonce: eventNonce(),
    });

    expect(
      managerResult.ok && managerResult.response.reasonCode,
    ).toBe("NO_APPROVED_BOOKING");
    expect(adminResult.ok && adminResult.response.reasonCode).toBe(
      "NO_APPROVED_BOOKING",
    );
  });

  it("enforces exact start and end time boundaries", () => {
    testDatabase.db
      .prepare(
        `INSERT INTO bookings (
           id, room_id, requester_id, purpose, expected_attendance,
           start_at, end_at, status, created_at, updated_at,
           decided_by, decided_at, decision_reason
         ) VALUES (
           'booking_exact_start', 'room_seminar_02', 'usr_amelia_chen',
           'Exact start boundary test', 4, ?, ?, 'approved',
           '2026-10-28T10:00:00.000Z', '2026-10-28T10:00:00.000Z',
           'usr_marcus_webb', '2026-10-28T10:00:00.000Z',
           'Boundary test approval.'
         )`,
      )
      .run(
        fixedNow.toISOString(),
        new Date(fixedNow.getTime() + 30 * 60_000).toISOString(),
      );

    testDatabase.db
      .prepare(
        `INSERT INTO bookings (
           id, room_id, requester_id, purpose, expected_attendance,
           start_at, end_at, status, created_at, updated_at,
           decided_by, decided_at, decision_reason
         ) VALUES (
           'booking_exact_end', 'room_library_quiet', 'usr_amelia_chen',
           'Exact end boundary test', 2, ?, ?, 'approved',
           '2026-10-28T10:00:00.000Z', '2026-10-28T10:00:00.000Z',
           'usr_priya_nair', '2026-10-28T10:00:00.000Z',
           'Boundary test approval.'
         )`,
      )
      .run(
        new Date(fixedNow.getTime() - 30 * 60_000).toISOString(),
        fixedNow.toISOString(),
      );

    const exactStart = simulateAccessCheck(testDatabase.db, student, {
      credentialId: "cred_amelia_active",
      roomId: "room_seminar_02",
      eventNonce: eventNonce(),
    });
    const exactEnd = simulateAccessCheck(testDatabase.db, student, {
      credentialId: "cred_amelia_active",
      roomId: "room_library_quiet",
      eventNonce: eventNonce(),
    });

    expect(exactStart.ok && exactStart.response.decision).toBe("ALLOW");
    expect(exactEnd.ok && exactEnd.response.reasonCode).toBe(
      "OUTSIDE_BOOKING_WINDOW",
    );
  });

  it("rate limits repeated access attempts and logs the rate-limit denial", () => {
    let rateLimitedResult: Awaited<ReturnType<typeof simulateAccessCheck>> | null =
      null;

    for (let index = 0; index < 21; index += 1) {
      const result = simulateAccessCheck(testDatabase.db, student, {
        credentialId: "cred_amelia_active",
        roomId: "room_library_quiet",
        eventNonce: eventNonce(),
      });

      if (index === 20) {
        rateLimitedResult = result;
      }
    }

    expect(rateLimitedResult).toMatchObject({
      ok: true,
      httpStatus: 429,
      response: {
        decision: "DENY",
        reasonCode: "RATE_LIMITED",
      },
    });
  });

  it("scopes access history to the actor, assigned rooms, and admin", () => {
    simulateAccessCheck(testDatabase.db, student, {
      credentialId: "cred_amelia_active",
      roomId: "room_classroom_14",
      eventNonce: eventNonce(),
    });

    const filters = {
      roomCode: "",
      result: "all" as const,
      reasonCode: "",
      date: "",
      page: 1,
    };

    const studentHistory = listAccessHistory(testDatabase.db, student, filters);
    const priyaHistory = listAccessHistory(testDatabase.db, priya, filters);
    const adminHistory = listAccessHistory(testDatabase.db, admin, filters);
    const otherStudentHistory = listAccessHistory(
      testDatabase.db,
      otherStudent,
      filters,
    );

    expect(
      studentHistory.items.every((event) => event.actorName === "Amelia Chen"),
    ).toBe(true);
    expect(priyaHistory.items.every((event) => event.roomCode === "MED-01")).toBe(
      true,
    );
    expect(adminHistory.items.length).toBeGreaterThan(priyaHistory.items.length);
    expect(otherStudentHistory.items).toEqual([]);
  });

  it("builds simulator choices from own credentials and active rooms", () => {
    const data = getAccessSimulatorData(testDatabase.db, student);

    expect(data.credentials.map((credential) => credential.id)).toEqual(
      expect.arrayContaining(["cred_amelia_active", "cred_amelia_revoked"]),
    );
    expect(data.credentials.map((credential) => credential.label).join(" ")).not.toContain(
      "demo-tag-amelia",
    );
    expect(data.suggestedRoomId).toBe("room_classroom_14");
    expect(data.rooms.every((room) => room.code !== "ARC-B1")).toBe(true);
  });

  it("parses access history filters without broadening scope", () => {
    const parsed = parseAccessHistoryFilters({
      room: "MED-01",
      result: "denied",
      reason: "CREDENTIAL_REVOKED",
      date: "2026-10-28",
    });

    expect(parsed.error).toBeUndefined();
    expect(parsed.filters).toMatchObject({
      roomCode: "MED-01",
      result: "denied",
      reasonCode: "CREDENTIAL_REVOKED",
      date: "2026-10-28",
    });
  });
});
