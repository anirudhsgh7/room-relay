import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProfileById } from "@/lib/auth/service";
import { cancelOwnBooking } from "@/lib/bookings/cancellation";
import { getMyBooking } from "@/lib/bookings/queries";
import { parseCampusInterval } from "@/lib/time/campus-time";
import { searchRooms } from "@/lib/rooms/queries";
import { createSeededTestDatabase } from "./helpers";

type SeededTestDatabase = Awaited<ReturnType<typeof createSeededTestDatabase>>;

const fixedNow = new Date("2026-10-28T12:00:00.000Z");

function auditCount(testDatabase: SeededTestDatabase): number {
  return (
    testDatabase.db
      .prepare("SELECT count(*) AS count FROM audit_events")
      .get() as { count: number }
  ).count;
}

describe("requester cancellation", () => {
  let testDatabase: SeededTestDatabase;
  let student: NonNullable<ReturnType<typeof getProfileById>>;
  let otherStudent: NonNullable<ReturnType<typeof getProfileById>>;
  let manager: NonNullable<ReturnType<typeof getProfileById>>;

  beforeEach(async () => {
    testDatabase = await createSeededTestDatabase(fixedNow);
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    student = getProfileById(testDatabase.db, "usr_amelia_chen")!;
    otherStudent = getProfileById(testDatabase.db, "usr_noah_williams")!;
    manager = getProfileById(testDatabase.db, "usr_priya_nair")!;
  });

  afterEach(() => {
    vi.useRealTimers();
    testDatabase.cleanup();
  });

  it("cancels the requester's pending request with one audit event", () => {
    const before = auditCount(testDatabase);
    const result = cancelOwnBooking(testDatabase.db, student, {
      bookingId: "booking_pending_media",
      reason: "The group changed its recording date.",
    });

    expect(result).toMatchObject({
      ok: true,
      receipt: {
        status: "cancelled",
        priorStatus: "pending",
      },
    });

    const row = testDatabase.db
      .prepare(
        "SELECT status, cancelled_by, cancellation_reason FROM bookings WHERE id = 'booking_pending_media'",
      )
      .get() as {
      status: string;
      cancelled_by: string;
      cancellation_reason: string;
    };

    expect(row).toEqual({
      status: "cancelled",
      cancelled_by: "usr_amelia_chen",
      cancellation_reason: "The group changed its recording date.",
    });
    expect(auditCount(testDatabase)).toBe(before + 1);
  });

  it("cancels a future approved booking and preserves its decision metadata", () => {
    const result = cancelOwnBooking(testDatabase.db, student, {
      bookingId: "booking_approved_seminar",
      reason: "The club no longer needs this room.",
    });

    expect(result.ok).toBe(true);

    const row = testDatabase.db
      .prepare(
        `SELECT status, decided_by, decision_reason, cancelled_by,
                cancellation_reason
         FROM bookings WHERE id = 'booking_approved_seminar'`,
      )
      .get() as {
      status: string;
      decided_by: string;
      decision_reason: string;
      cancelled_by: string;
      cancellation_reason: string;
    };

    expect(row).toMatchObject({
      status: "cancelled",
      decided_by: "usr_marcus_webb",
      cancelled_by: "usr_amelia_chen",
      cancellation_reason: "The club no longer needs this room.",
    });
    expect(row.decision_reason).toBeTruthy();
  });

  it("stops a cancelled interval from blocking room searches", () => {
    const roomInterval = parseCampusInterval(
      "2026-10-29",
      "16:00",
      "17:30",
      "Europe/London",
    );
    expect(roomInterval.ok).toBe(true);
    if (!roomInterval.ok) return;

    const beforeCancellation = searchRooms(
      testDatabase.db,
      student,
      { minCapacity: null, building: "Hazelwood Hall", facilities: [] },
      roomInterval.interval,
    );
    expect(beforeCancellation[0]?.availability).toBe("conflict");

    cancelOwnBooking(testDatabase.db, student, {
      bookingId: "booking_approved_seminar",
      reason: "The club has cancelled the session.",
    });

    const afterCancellation = searchRooms(
      testDatabase.db,
      student,
      { minCapacity: null, building: "Hazelwood Hall", facilities: [] },
      roomInterval.interval,
    );
    expect(afterCancellation[0]?.availability).toBe("available");
  });

  it("does not let another user cancel the booking", () => {
    const before = auditCount(testDatabase);
    const result = cancelOwnBooking(testDatabase.db, otherStudent, {
      bookingId: "booking_pending_media",
      reason: "This should never change another user's booking.",
    });

    expect(result).toMatchObject({ ok: false, kind: "not_found" });
    expect(auditCount(testDatabase)).toBe(before);
  });

  it("does not let a manager cancel on the requester's behalf", () => {
    const result = cancelOwnBooking(testDatabase.db, manager, {
      bookingId: "booking_pending_media",
      reason: "Manager-side cancellation is not part of this phase.",
    });

    expect(result).toMatchObject({ ok: false, kind: "not_found" });
  });

  it("refuses cancellation after the approved booking has started", () => {
    vi.setSystemTime(new Date("2026-10-29T17:00:00.000Z"));

    const result = cancelOwnBooking(testDatabase.db, student, {
      bookingId: "booking_approved_seminar",
      reason: "This is too late to withdraw the approved booking.",
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "not_cancellable",
    });
  });

  it("does not duplicate the audit event when cancellation is retried", () => {
    const first = cancelOwnBooking(testDatabase.db, student, {
      bookingId: "booking_pending_media",
      reason: "The group changed its recording date.",
    });
    expect(first.ok).toBe(true);
    const afterFirst = auditCount(testDatabase);

    const second = cancelOwnBooking(testDatabase.db, student, {
      bookingId: "booking_pending_media",
      reason: "The group changed its recording date again.",
    });

    expect(second).toMatchObject({
      ok: false,
      kind: "not_cancellable",
      currentStatus: "cancelled",
    });
    expect(auditCount(testDatabase)).toBe(afterFirst);
  });

  it("marks a cancelled booking as non-cancellable in requester reads", () => {
    cancelOwnBooking(testDatabase.db, student, {
      bookingId: "booking_pending_media",
      reason: "The group changed its recording date.",
    });

    const booking = getMyBooking(
      testDatabase.db,
      student,
      "booking_pending_media",
    );
    expect(booking?.status).toBe("cancelled");
    expect(booking?.canCancel).toBe(false);
    expect(booking?.cancellationReason).toBe(
      "The group changed its recording date.",
    );
  });
});
