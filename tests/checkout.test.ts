import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProfileById } from "@/lib/auth/service";
import { simulateAccessCheck } from "@/lib/access/service";
import { checkOutBooking } from "@/lib/bookings/checkout";
import { clearRateLimitsForTests } from "@/lib/rate-limit";
import { createSeededTestDatabase } from "./helpers";

type SeededTestDatabase = Awaited<ReturnType<typeof createSeededTestDatabase>>;

const fixedNow = new Date("2026-10-28T12:00:00.000Z");

function tableCount(
  testDatabase: SeededTestDatabase,
  table: "condition_reports" | "incidents" | "audit_events",
): number {
  return (
    testDatabase.db
      .prepare(`SELECT count(*) AS count FROM ${table}`)
      .get() as { count: number }
  ).count;
}

function checkInActiveBooking(testDatabase: SeededTestDatabase): void {
  const student = getProfileById(testDatabase.db, "usr_amelia_chen")!;
  const result = simulateAccessCheck(testDatabase.db, student, {
    credentialId: "cred_amelia_active",
    roomId: "room_classroom_14",
    eventNonce: randomUUID(),
  });

  if (!result.ok || result.response.decision !== "ALLOW") {
    throw new Error("Failed to prepare the checked-in demo booking.");
  }
}

describe("requester check-out and condition reports", () => {
  let testDatabase: SeededTestDatabase;
  let student: NonNullable<ReturnType<typeof getProfileById>>;
  let otherStudent: NonNullable<ReturnType<typeof getProfileById>>;

  beforeEach(async () => {
    testDatabase = await createSeededTestDatabase(fixedNow);
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    clearRateLimitsForTests();
    student = getProfileById(testDatabase.db, "usr_amelia_chen")!;
    otherStudent = getProfileById(testDatabase.db, "usr_noah_williams")!;
  });

  afterEach(() => {
    clearRateLimitsForTests();
    vi.useRealTimers();
    testDatabase.cleanup();
  });

  it("completes a clean checked-in booking with an after report", () => {
    checkInActiveBooking(testDatabase);
    const beforeConditions = tableCount(testDatabase, "condition_reports");
    const beforeAudit = tableCount(testDatabase, "audit_events");

    const result = checkOutBooking(testDatabase.db, student, {
      bookingId: "booking_demo_active_classroom",
      conditionState: "left_as_found",
      notes: "Room left as found. Chairs reset and projector off.",
    });

    expect(result).toMatchObject({
      ok: true,
      receipt: { status: "completed" },
    });
    expect(tableCount(testDatabase, "condition_reports")).toBe(
      beforeConditions + 1,
    );
    expect(tableCount(testDatabase, "audit_events")).toBe(beforeAudit + 2);

    const row = testDatabase.db
      .prepare(
        `SELECT status, checked_out_at, closed_at, closure_reason
         FROM bookings WHERE id = 'booking_demo_active_classroom'`,
      )
      .get() as {
      status: string;
      checked_out_at: string;
      closed_at: string;
      closure_reason: string;
    };

    expect(row.status).toBe("completed");
    expect(row.checked_out_at).toBeTruthy();
    expect(row.closed_at).toBeTruthy();
    expect(row.closure_reason).toBe("left_as_found");

    const report = testDatabase.db
      .prepare(
        `SELECT stage, condition_state, notes
         FROM condition_reports
         WHERE booking_id = 'booking_demo_active_classroom' AND stage = 'after'`,
      )
      .get() as { stage: string; condition_state: string; notes: string };
    expect(report.stage).toBe("after");
    expect(report.condition_state).toBe("left_as_found");
    expect(report.notes).toContain("Chairs reset");
  });

  it("creates an open incident for an issue check-out", () => {
    checkInActiveBooking(testDatabase);
    const beforeIncidents = tableCount(testDatabase, "incidents");

    const result = checkOutBooking(testDatabase.db, student, {
      bookingId: "booking_demo_active_classroom",
      conditionState: "issue_found",
      notes: "The room was usable but a chair was damaged.",
      incidentCategory: "damage",
      issueDescription:
        "The left-hand chair has a broken armrest and needs repair.",
    });

    expect(result).toMatchObject({
      ok: true,
      receipt: { status: "incident" },
    });
    expect(tableCount(testDatabase, "incidents")).toBe(beforeIncidents + 1);

    const booking = testDatabase.db
      .prepare(
        "SELECT status, closed_at, closure_reason FROM bookings WHERE id = 'booking_demo_active_classroom'",
      )
      .get() as {
      status: string;
      closed_at: string | null;
      closure_reason: string;
    };
    expect(booking).toMatchObject({
      status: "incident",
      closed_at: null,
      closure_reason: "issue_found",
    });

    const incident = testDatabase.db
      .prepare(
        `SELECT category, status, reporter_id, resolution_note
         FROM incidents
         WHERE booking_id = 'booking_demo_active_classroom'`,
      )
      .get() as {
      category: string;
      status: string;
      reporter_id: string;
      resolution_note: string | null;
    };
    expect(incident).toEqual({
      category: "damage",
      status: "open",
      reporter_id: "usr_amelia_chen",
      resolution_note: null,
    });
  });

  it("rejects checkout by a different requester", () => {
    checkInActiveBooking(testDatabase);
    const beforeConditions = tableCount(testDatabase, "condition_reports");

    const result = checkOutBooking(testDatabase.db, otherStudent, {
      bookingId: "booking_demo_active_classroom",
      conditionState: "left_as_found",
      notes: "Trying to check out another user's booking.",
    });

    expect(result).toMatchObject({ ok: false, kind: "not_found" });
    expect(tableCount(testDatabase, "condition_reports")).toBe(
      beforeConditions,
    );
  });

  it("rejects checkout for a booking that is not checked in", () => {
    const result = checkOutBooking(testDatabase.db, student, {
      bookingId: "booking_pending_media",
      conditionState: "left_as_found",
      notes: "This pending request cannot be checked out.",
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "not_checkable",
      currentStatus: "pending",
    });
  });

  it("rejects a duplicate checkout after completion", () => {
    checkInActiveBooking(testDatabase);
    const first = checkOutBooking(testDatabase.db, student, {
      bookingId: "booking_demo_active_classroom",
      conditionState: "left_as_found",
      notes: "Room left as found after the demo.",
    });
    expect(first.ok).toBe(true);
    const afterFirst = tableCount(testDatabase, "condition_reports");

    const second = checkOutBooking(testDatabase.db, student, {
      bookingId: "booking_demo_active_classroom",
      conditionState: "left_as_found",
      notes: "A duplicate check-out attempt.",
    });

    expect(second).toMatchObject({
      ok: false,
      kind: "not_checkable",
      currentStatus: "completed",
    });
    expect(tableCount(testDatabase, "condition_reports")).toBe(afterFirst);
  });

  it("requires valid condition and issue fields", () => {
    checkInActiveBooking(testDatabase);
    const missingNotes = checkOutBooking(testDatabase.db, student, {
      bookingId: "booking_demo_active_classroom",
      conditionState: "left_as_found",
      notes: "no",
    });
    const missingIssue = checkOutBooking(testDatabase.db, student, {
      bookingId: "booking_demo_active_classroom",
      conditionState: "issue_found",
      notes: "A valid condition note.",
      incidentCategory: "",
      issueDescription: "",
    });

    expect(missingNotes).toMatchObject({ ok: false, kind: "validation" });
    expect(missingIssue).toMatchObject({ ok: false, kind: "validation" });
  });
});
