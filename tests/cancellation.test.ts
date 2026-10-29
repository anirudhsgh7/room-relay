import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "@/lib/auth/service";
import { cancelOwnBooking } from "@/lib/bookings/cancellation";
import { getMyBooking } from "@/lib/bookings/queries";
import { parseCampusInterval } from "@/lib/time/campus-time";
import { searchRooms } from "@/lib/rooms/queries";
import { createSeededTestDatabase, getTestProfile } from "./helpers";

type SeededTestDatabase = Awaited<ReturnType<typeof createSeededTestDatabase>>;

const fixedNow = new Date("2026-10-28T12:00:00.000Z");

async function auditCount(testDatabase: SeededTestDatabase): Promise<number> {
  return (
    (await testDatabase.db
      .prepare("SELECT count(*) AS count FROM audit_events")
      .get()) as { count: number }
  ).count;
}

describe("requester cancellation", () => {
  let testDatabase: SeededTestDatabase;
  let student: UserProfile;
  let otherStudent: UserProfile;
  let manager: UserProfile;

  beforeEach(async () => {
    testDatabase = await createSeededTestDatabase(fixedNow);
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    student = await getTestProfile(testDatabase.db, "usr_amelia_chen");
    otherStudent = await getTestProfile(testDatabase.db, "usr_noah_williams");
    manager = await getTestProfile(testDatabase.db, "usr_priya_nair");
  });

  afterEach(() => {
    vi.useRealTimers();
    testDatabase.cleanup();
  });

  it("cancels the requester's pending request with one audit event", async () => {
    const before = await auditCount(testDatabase);
    const result = await cancelOwnBooking(testDatabase.db, student, {
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

    const row = await testDatabase.db
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
    expect(await auditCount(testDatabase)).toBe(before + 1);
  });

  it("cancels a future approved booking and preserves its decision metadata", async () => {
    const result = await cancelOwnBooking(testDatabase.db, student, {
      bookingId: "booking_approved_seminar",
      reason: "The club no longer needs this room.",
    });

    expect(result.ok).toBe(true);

    const row = await testDatabase.db
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

  it("stops a cancelled interval from blocking room searches", async () => {
    const roomInterval = parseCampusInterval(
      "2026-10-29",
      "16:00",
      "17:30",
      "Europe/London",
    );
    expect(roomInterval.ok).toBe(true);
    if (!roomInterval.ok) return;

    const beforeCancellation = await searchRooms(
      testDatabase.db,
      student,
      { minCapacity: null, building: "Hazelwood Hall", facilities: [] },
      roomInterval.interval,
    );
    expect(beforeCancellation[0]?.availability).toBe("conflict");

    await cancelOwnBooking(testDatabase.db, student, {
      bookingId: "booking_approved_seminar",
      reason: "The club has cancelled the session.",
    });

    const afterCancellation = await searchRooms(
      testDatabase.db,
      student,
      { minCapacity: null, building: "Hazelwood Hall", facilities: [] },
      roomInterval.interval,
    );
    expect(afterCancellation[0]?.availability).toBe("available");
  });

  it("does not let another user cancel the booking", async () => {
    const before = await auditCount(testDatabase);
    const result = await cancelOwnBooking(testDatabase.db, otherStudent, {
      bookingId: "booking_pending_media",
      reason: "This should never change another user's booking.",
    });

    expect(result).toMatchObject({ ok: false, kind: "not_found" });
    expect(await auditCount(testDatabase)).toBe(before);
  });

  it("does not let a manager cancel on the requester's behalf", async () => {
    const result = await cancelOwnBooking(testDatabase.db, manager, {
      bookingId: "booking_pending_media",
      reason: "Manager-side cancellation is not part of this phase.",
    });

    expect(result).toMatchObject({ ok: false, kind: "not_found" });
  });

  it("refuses cancellation after the approved booking has started", async () => {
    vi.setSystemTime(new Date("2026-10-29T17:00:00.000Z"));

    const result = await cancelOwnBooking(testDatabase.db, student, {
      bookingId: "booking_approved_seminar",
      reason: "This is too late to withdraw the approved booking.",
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "not_cancellable",
    });
  });

  it("does not duplicate the audit event when cancellation is retried", async () => {
    const first = await cancelOwnBooking(testDatabase.db, student, {
      bookingId: "booking_pending_media",
      reason: "The group changed its recording date.",
    });
    expect(first.ok).toBe(true);
    const afterFirst = await auditCount(testDatabase);

    const second = await cancelOwnBooking(testDatabase.db, student, {
      bookingId: "booking_pending_media",
      reason: "The group changed its recording date again.",
    });

    expect(second).toMatchObject({
      ok: false,
      kind: "not_cancellable",
      currentStatus: "cancelled",
    });
    expect(await auditCount(testDatabase)).toBe(afterFirst);
  });

  it("marks a cancelled booking as non-cancellable in requester reads", async () => {
    await cancelOwnBooking(testDatabase.db, student, {
      bookingId: "booking_pending_media",
      reason: "The group changed its recording date.",
    });

    const booking = await getMyBooking(
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
