import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProfileById } from "@/lib/auth/service";
import { getMyBooking, listMyBookings } from "@/lib/bookings/queries";
import { submitBookingRequest } from "@/lib/bookings/service";
import type { BookingRequestSubmission } from "@/lib/bookings/validation";
import { clearRateLimitsForTests } from "@/lib/rate-limit";
import { createSeededTestDatabase } from "./helpers";

type SeededTestDatabase = Awaited<ReturnType<typeof createSeededTestDatabase>>;

const fixedNow = new Date("2026-10-28T12:00:00.000Z");

function submission(
  overrides: Partial<BookingRequestSubmission> = {},
): BookingRequestSubmission {
  return {
    roomCode: "SEM-02",
    startDate: "2026-10-29",
    startTime: "10:00",
    endTime: "11:30",
    purpose: "Robotics club weekly build session",
    groupName: "Robotics Club",
    expectedAttendance: "8",
    acknowledgement: "on",
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

function auditCount(testDatabase: SeededTestDatabase): number {
  return (
    testDatabase.db
      .prepare("SELECT count(*) AS count FROM audit_events")
      .get() as { count: number }
  ).count;
}

describe("booking request service", () => {
  let testDatabase: SeededTestDatabase;
  let student: NonNullable<ReturnType<typeof getProfileById>>;
  let manager: NonNullable<ReturnType<typeof getProfileById>>;

  beforeEach(async () => {
    testDatabase = await createSeededTestDatabase(fixedNow);
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    clearRateLimitsForTests();
    student = getProfileById(testDatabase.db, "usr_amelia_chen")!;
    manager = getProfileById(testDatabase.db, "usr_marcus_webb")!;
  });

  afterEach(() => {
    clearRateLimitsForTests();
    vi.useRealTimers();
    testDatabase.cleanup();
  });

  it("persists a valid request as pending and appends one audit event", () => {
    const beforeAudit = auditCount(testDatabase);
    const result = submitBookingRequest(
      testDatabase.db,
      student,
      submission(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.kind).toBe("created");
    expect(result.receipt.status).toBe("pending");
    expect(result.receipt.roomCode).toBe("SEM-02");
    expect(result.receipt.startAt).toBe("2026-10-29T10:00:00Z");
    expect(result.receipt.endAt).toBe("2026-10-29T11:30:00Z");

    const row = testDatabase.db
      .prepare(
        `SELECT status, requester_id, decided_by, decided_at, decision_reason,
                submission_key, request_payload_hash, eligibility_snapshot_json
         FROM bookings WHERE id = ?`,
      )
      .get(result.receipt.id) as {
      status: string;
      requester_id: string;
      decided_by: string | null;
      decided_at: string | null;
      decision_reason: string | null;
      submission_key: string;
      request_payload_hash: string;
      eligibility_snapshot_json: string;
    };

    expect(row).toMatchObject({
      status: "pending",
      requester_id: "usr_amelia_chen",
      decided_by: null,
      decided_at: null,
      decision_reason: null,
    });
    expect(row.submission_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.request_payload_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(row.eligibility_snapshot_json)).toEqual([
      expect.objectContaining({
        requirementId: "req_seminar_club_briefing",
        status: "verified",
      }),
    ]);
    expect(auditCount(testDatabase)).toBe(beforeAudit + 1);
  });

  it("ignores forged status, requester, and decision fields", () => {
    const result = submitBookingRequest(testDatabase.db, student, {
      ...submission(),
      status: "approved",
      requesterId: "usr_marcus_webb",
      decidedBy: "usr_marcus_webb",
    } as BookingRequestSubmission);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = testDatabase.db
      .prepare(
        "SELECT status, requester_id, decided_by FROM bookings WHERE id = ?",
      )
      .get(result.receipt.id) as {
      status: string;
      requester_id: string;
      decided_by: string | null;
    };

    expect(row).toEqual({
      status: "pending",
      requester_id: "usr_amelia_chen",
      decided_by: null,
    });
  });

  it("returns the original receipt for an idempotent retry", () => {
    const payload = submission();
    const first = submitBookingRequest(testDatabase.db, student, payload);
    const second = submitBookingRequest(testDatabase.db, student, payload);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.kind).toBe("existing");
    expect(second.receipt.id).toBe(first.receipt.id);

    const count = testDatabase.db
      .prepare("SELECT count(*) AS count FROM bookings")
      .get() as { count: number };
    expect(count.count).toBe(11);
  });

  it("rejects an idempotency key reused with a different payload", () => {
    const payload = submission();
    const first = submitBookingRequest(testDatabase.db, student, payload);
    expect(first.ok).toBe(true);

    const second = submitBookingRequest(
      testDatabase.db,
      student,
      {
        ...payload,
        purpose: "A different purpose entirely",
        expectedAttendance: "9",
      },
    );

    expect(second).toMatchObject({
      ok: false,
      kind: "idempotency_mismatch",
    });
  });

  it("blocks a confirmed slot and returns safe alternatives", () => {
    const result = submitBookingRequest(
      testDatabase.db,
      student,
      submission({ startTime: "16:00", endTime: "17:30" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.kind).toBe("conflict");
    if (result.kind !== "conflict") return;
    expect(result.message).not.toMatch(/Robotics|Amelia|approved_seminar/i);
    expect(result.alternatives.length).toBeLessThanOrEqual(3);
    expect(result.alternatives.length).toBeGreaterThan(0);
  });

  it("allows an interval starting exactly when a confirmed booking ends", () => {
    const result = submitBookingRequest(
      testDatabase.db,
      student,
      submission({
        startTime: "17:30",
        endTime: "18:30",
        purpose: "Robotics club follow-up planning",
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.receipt.status).toBe("pending");
    }
  });

  it("allows a request ending exactly at room closing time", () => {
    const result = submitBookingRequest(
      testDatabase.db,
      student,
      submission({
        roomCode: "MED-01",
        startDate: "2026-10-30",
        startTime: "20:30",
        endTime: "21:00",
        purpose: "Late media recording session",
        groupName: "Campus Radio",
        expectedAttendance: "4",
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.receipt.status).toBe("pending");
    }
  });

  it("blocks the same student's overlapping pending request", () => {
    const result = submitBookingRequest(
      testDatabase.db,
      student,
      submission({
        roomCode: "MED-01",
        startDate: "2026-10-30",
        startTime: "15:00",
        endTime: "16:00",
        purpose: "Media recording follow-up",
        groupName: "Campus Radio",
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      kind: "duplicate",
      bookingId: "booking_pending_media",
    });
  });

  it("enforces capacity and returns a field error", () => {
    const result = submitBookingRequest(
      testDatabase.db,
      student,
      submission({ expectedAttendance: "19" }),
    );

    expect(result).toMatchObject({
      ok: false,
      kind: "validation",
      fieldErrors: {
        expectedAttendance: "This room holds up to 18 people.",
      },
    });
  });

  it("enforces minimum notice, slot boundaries, and duration", () => {
    vi.setSystemTime(new Date("2026-10-28T12:10:00.000Z"));
    const tooSoon = submitBookingRequest(
      testDatabase.db,
      student,
      submission({
        startDate: "2026-10-28",
        startTime: "12:30",
        endTime: "13:00",
      }),
    );
    const offBoundary = submitBookingRequest(
      testDatabase.db,
      student,
      submission({ startTime: "10:15", endTime: "11:15" }),
    );
    const tooLong = submitBookingRequest(
      testDatabase.db,
      student,
      submission({ startTime: "08:00", endTime: "13:00" }),
    );

    expect(tooSoon).toMatchObject({ ok: false, kind: "validation" });
    expect(offBoundary).toMatchObject({ ok: false, kind: "validation" });
    expect(tooLong).toMatchObject({ ok: false, kind: "validation" });
    if (!tooSoon.ok && tooSoon.kind === "validation") {
      expect(tooSoon.fieldErrors.startTime).toMatch(/minutes' notice/);
    }
    if (!offBoundary.ok && offBoundary.kind === "validation") {
      expect(offBoundary.fieldErrors.startTime).toMatch(/30-minute increments/);
    }
    if (!tooLong.ok && tooLong.kind === "validation") {
      expect(tooLong.fieldErrors.endTime).toMatch(/maximum duration/);
    }
  });

  it("rejects out-of-hours and malformed local intervals", () => {
    const outside = submitBookingRequest(
      testDatabase.db,
      student,
      submission({ startTime: "23:00", endTime: "23:30" }),
    );
    const dstGap = submitBookingRequest(
      testDatabase.db,
      student,
      submission({
        startDate: "2027-03-28",
        startTime: "01:30",
        endTime: "02:30",
      }),
    );

    expect(outside).toMatchObject({ ok: false, kind: "outside_hours" });
    expect(dstGap).toMatchObject({ ok: false, kind: "validation" });
  });

  it("allows managers to browse but not submit student requests", () => {
    const result = submitBookingRequest(
      testDatabase.db,
      manager,
      submission(),
    );

    expect(result).toMatchObject({ ok: false, kind: "forbidden" });
  });

  it("shows unverified eligibility warnings without blocking a pending request", () => {
    const result = submitBookingRequest(
      testDatabase.db,
      student,
      submission({
        roomCode: "MED-01",
        startDate: "2026-10-30",
        startTime: "10:00",
        endTime: "11:00",
        purpose: "Record a short media segment",
        groupName: "Campus Radio",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.eligibilityWarnings).toEqual([
      expect.objectContaining({
        requirementId: "req_media_equipment_induction",
      }),
    ]);
    expect(result.receipt.status).toBe("pending");
  });

  it("scopes request reads to the authenticated requester", () => {
    const result = submitBookingRequest(
      testDatabase.db,
      student,
      submission(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(
      getMyBooking(testDatabase.db, student, result.receipt.id)?.id,
    ).toBe(result.receipt.id);
    expect(
      getMyBooking(testDatabase.db, manager, result.receipt.id),
    ).toBeNull();

    const studentList = listMyBookings(testDatabase.db, student);
    const managerList = listMyBookings(testDatabase.db, manager);
    expect(studentList.some((booking) => booking.id === result.receipt.id)).toBe(
      true,
    );
    expect(managerList).toEqual([]);
  });
});
