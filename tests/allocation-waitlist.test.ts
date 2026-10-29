import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "@/lib/auth/service";
import { getAllocationStanding } from "@/lib/allocation/ranking";
import {
  cancelBookingAsStaff,
  cancelOwnBooking,
} from "@/lib/bookings/cancellation";
import { decideBooking } from "@/lib/bookings/decisions";
import { submitBookingRequest } from "@/lib/bookings/service";
import type { BookingRequestSubmission } from "@/lib/bookings/validation";
import { AUTO_DECLINE_REASON, getWaitlistStanding } from "@/lib/bookings/waitlist";
import { clearRateLimitsForTests } from "@/lib/rate-limit";
import { createSeededTestDatabase, getTestProfile } from "./helpers";

type SeededTestDatabase = Awaited<ReturnType<typeof createSeededTestDatabase>>;
type Profile = UserProfile;

const fixedNow = new Date("2026-10-28T12:00:00.000Z");
const MEDIA_OVERRIDE = {
  overrideRequirementIds: ["req_media_equipment_induction"],
  overrideReason: "Induction completed with the technician last week; record pending.",
};

async function status(testDatabase: SeededTestDatabase, id: string): Promise<string> {
  return (
    (await testDatabase.db
      .prepare("SELECT status FROM bookings WHERE id = ?")
      .get(id)) as { status: string }
  ).status;
}

async function notificationsFor(
  testDatabase: SeededTestDatabase,
  recipientId: string,
): Promise<Array<{ kind: string; title: string; body: string; booking_id: string | null }>> {
  return (await testDatabase.db
    .prepare(
      `SELECT kind, title, body, booking_id
       FROM notifications
       WHERE recipient_id = ?
       ORDER BY created_at, id`,
    )
    .all(recipientId)) as Array<{
    kind: string;
    title: string;
    body: string;
    booking_id: string | null;
  }>;
}

async function setRule(testDatabase: SeededTestDatabase, roomId: string, rule: string): Promise<void> {
  await testDatabase.db
    .prepare("UPDATE room_booking_policies SET allocation_rule = ? WHERE room_id = ?")
    .run(rule, roomId);
}

function submission(
  overrides: Partial<BookingRequestSubmission> = {},
): BookingRequestSubmission {
  return {
    roomCode: "SEM-02",
    startDate: "2026-10-29",
    startTime: "16:00",
    endTime: "17:00",
    purpose: "Debate society practice round",
    groupName: "Debate Society",
    expectedAttendance: "8",
    acknowledgement: "on",
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

describe("published allocation rules", () => {
  let testDatabase: SeededTestDatabase;

  beforeEach(async () => {
    testDatabase = await createSeededTestDatabase(fixedNow);
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
  });

  afterEach(() => {
    vi.useRealTimers();
    testDatabase.cleanup();
  });

  it("ranks first come, first served by submission time", async () => {
    const amelia = await getAllocationStanding(testDatabase.db, "booking_pending_media", ["pending"]);
    const noah = await getAllocationStanding(
      testDatabase.db,
      "booking_pending_media_overlap",
      ["pending"],
    );

    expect(amelia).toMatchObject({ rule: "first_come", position: 1, total: 2 });
    expect(noah).toMatchObject({ position: 2, total: 2 });
    expect(noah?.ahead.map((item) => item.id)).toEqual(["booking_pending_media"]);
    expect(noah?.ahead[0]?.comparison).toBe("submitted earlier");
  });

  it("ranks best use of space by expected group size", async () => {
    await setRule(testDatabase, "room_media_studio", "best_fit");
    await testDatabase.db
      .prepare("UPDATE bookings SET expected_attendance = 8 WHERE id = 'booking_pending_media_overlap'")
      .run();

    const noah = await getAllocationStanding(
      testDatabase.db,
      "booking_pending_media_overlap",
      ["pending"],
    );

    expect(noah?.position).toBe(1);
    expect(noah?.behind[0]?.comparison).toBe("larger group (8 vs 6 people)");
  });

  it("ranks fair share by confirmed hours already used in the room", async () => {
    await setRule(testDatabase, "room_media_studio", "fair_share");

    // Amelia already used the studio for an hour six days ago; Noah has not.
    const noah = await getAllocationStanding(
      testDatabase.db,
      "booking_pending_media_overlap",
      ["pending"],
    );

    expect(noah?.position).toBe(1);
    expect(noah?.behind[0]?.comparison).toContain("fewer recent hours");
  });

  it("puts requests that already meet room requirements first under every rule", async () => {
    await testDatabase.db
      .prepare(
        `INSERT INTO profile_eligibility (
           id, profile_id, requirement_id, status, verified_by, verified_at,
           expires_at, created_at, updated_at
         ) VALUES (
           'elig_noah_media', 'usr_noah_williams', 'req_media_equipment_induction',
           'verified', 'usr_priya_nair', '2026-10-20T10:00:00.000Z', NULL,
           '2026-10-20T10:00:00.000Z', '2026-10-20T10:00:00.000Z'
         )`,
      )
      .run();

    const noah = await getAllocationStanding(
      testDatabase.db,
      "booking_pending_media_overlap",
      ["pending"],
    );

    expect(noah?.position).toBe(1);
    expect(noah?.behind[0]?.comparison).toBe("already meets the room requirements");
  });
});

describe("decisions under the published rule", () => {
  let testDatabase: SeededTestDatabase;
  let priya: Profile;
  let marcus: Profile;
  let amelia: Profile;
  let noah: Profile;

  beforeEach(async () => {
    testDatabase = await createSeededTestDatabase(fixedNow);
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    clearRateLimitsForTests();
    priya = await getTestProfile(testDatabase.db, "usr_priya_nair");
    marcus = await getTestProfile(testDatabase.db, "usr_marcus_webb");
    amelia = await getTestProfile(testDatabase.db, "usr_amelia_chen");
    noah = await getTestProfile(testDatabase.db, "usr_noah_williams");
  });

  afterEach(() => {
    clearRateLimitsForTests();
    vi.useRealTimers();
    testDatabase.cleanup();
  });

  it("requires a recorded reason to approve out of order and saves nothing without one", async () => {
    const blocked = await decideBooking(testDatabase.db, priya, {
      bookingId: "booking_pending_media_overlap",
      action: "approve",
      decisionReason: "Documentary interview fits the studio well.",
      ...MEDIA_OVERRIDE,
    });

    expect(blocked).toMatchObject({ ok: false, kind: "allocation_order" });
    if (blocked.ok || blocked.kind !== "allocation_order") return;
    expect(blocked.outranking.map((item) => item.id)).toEqual(["booking_pending_media"]);
    expect(blocked.ruleLabel).toBe("First come, first served");
    expect(await status(testDatabase, "booking_pending_media_overlap")).toBe("pending");

    const approved = await decideBooking(testDatabase.db, priya, {
      bookingId: "booking_pending_media_overlap",
      action: "approve",
      decisionReason: "Documentary interview fits the studio well.",
      ...MEDIA_OVERRIDE,
      allocationExceptionReason: "Film Society deadline is fixed by the festival; radio can move.",
    });

    expect(approved).toMatchObject({ ok: true, kind: "decided" });
    const row = await testDatabase.db
      .prepare("SELECT allocation_exception_reason FROM bookings WHERE id = ?")
      .get("booking_pending_media_overlap") as { allocation_exception_reason: string };
    expect(row.allocation_exception_reason).toContain("festival");

    const audit = await testDatabase.db
      .prepare(
        "SELECT metadata_json FROM audit_events WHERE entity_id = ? AND action = 'booking.approved'",
      )
      .get("booking_pending_media_overlap") as { metadata_json: string };
    expect(JSON.parse(audit.metadata_json).allocation).toMatchObject({
      rule: "first_come",
      position: 2,
      competing: 1,
      outrankedBy: ["booking_pending_media"],
    });
  });

  it("moves conflicting requests to the waitlist and tells everyone involved", async () => {
    const result = await decideBooking(testDatabase.db, priya, {
      bookingId: "booking_pending_media",
      action: "approve",
      decisionReason: "First in line under the studio's rule.",
      ...MEDIA_OVERRIDE,
    });

    expect(result).toMatchObject({
      ok: true,
      receipt: { status: "approved", waitlistedCount: 1, declinedCount: 0 },
    });
    expect(await status(testDatabase, "booking_pending_media_overlap")).toBe("waitlisted");

    const waitlistedAt = await testDatabase.db
      .prepare("SELECT waitlisted_at FROM bookings WHERE id = ?")
      .get("booking_pending_media_overlap") as { waitlisted_at: string | null };
    expect(waitlistedAt.waitlisted_at).toBe(fixedNow.toISOString());

    expect((await notificationsFor(testDatabase, amelia.id)).map((item) => item.kind)).toEqual([
      "decision_approved",
    ]);
    const noahInbox = await notificationsFor(testDatabase, noah.id);
    expect(noahInbox).toHaveLength(1);
    expect(noahInbox[0]).toMatchObject({ kind: "waitlisted" });
    expect(noahInbox[0]?.body).toContain("You are number 1 on the waitlist.");
    expect(noahInbox[0]?.body).toContain("First come, first served");

    const standing = await getWaitlistStanding(testDatabase.db, "booking_pending_media_overlap");
    expect(standing).toMatchObject({ position: 1, total: 1 });
  });

  it("declines conflicting requests with a stated reason when the room keeps no waitlist", async () => {
    await testDatabase.db
      .prepare("UPDATE room_booking_policies SET waitlist_enabled = 0 WHERE room_id = 'room_media_studio'")
      .run();

    const result = await decideBooking(testDatabase.db, priya, {
      bookingId: "booking_pending_media",
      action: "approve",
      decisionReason: "First in line under the studio's rule.",
      ...MEDIA_OVERRIDE,
    });

    expect(result).toMatchObject({ ok: true, receipt: { declinedCount: 1 } });
    const row = await testDatabase.db
      .prepare("SELECT status, decision_reason, decided_by FROM bookings WHERE id = ?")
      .get("booking_pending_media_overlap") as {
      status: string;
      decision_reason: string;
      decided_by: string;
    };
    expect(row).toEqual({
      status: "rejected",
      decision_reason: AUTO_DECLINE_REASON,
      decided_by: priya.id,
    });
    expect((await notificationsFor(testDatabase, noah.id))[0]?.kind).toBe("decision_rejected");
  });

  it("returns a waitlisted request to review when the approved booking is cancelled", async () => {
    await decideBooking(testDatabase.db, priya, {
      bookingId: "booking_pending_media",
      action: "approve",
      decisionReason: "First in line under the studio's rule.",
      ...MEDIA_OVERRIDE,
    });

    const cancelled = await cancelOwnBooking(testDatabase.db, amelia, {
      bookingId: "booking_pending_media",
      reason: "Radio show moved to next week.",
    });

    expect(cancelled).toMatchObject({ ok: true, receipt: { promotedCount: 1 } });
    expect(await status(testDatabase, "booking_pending_media_overlap")).toBe("pending");

    const promotedAt = await testDatabase.db
      .prepare("SELECT promoted_at FROM bookings WHERE id = ?")
      .get("booking_pending_media_overlap") as { promoted_at: string | null };
    expect(promotedAt.promoted_at).not.toBeNull();

    expect(
      (await notificationsFor(testDatabase, noah.id)).map((item) => item.kind).sort(),
    ).toEqual(["waitlist_promoted", "waitlisted"]);
    expect((await notificationsFor(testDatabase, priya.id)).map((item) => item.kind)).toEqual(
      expect.arrayContaining(["booking_cancelled", "decision_needed"]),
    );

    const promotedAudit = await testDatabase.db
      .prepare(
        "SELECT actor_id FROM audit_events WHERE entity_id = ? AND action = 'booking.promoted'",
      )
      .get("booking_pending_media_overlap") as { actor_id: string | null } | undefined;
    expect(promotedAudit).toEqual({ actor_id: null });
  });

  it("keeps a waitlisted request waiting when the freed time is now closed", async () => {
    await decideBooking(testDatabase.db, priya, {
      bookingId: "booking_pending_media",
      action: "approve",
      decisionReason: "First in line under the studio's rule.",
      ...MEDIA_OVERRIDE,
    });
    await testDatabase.db
      .prepare(
        `INSERT INTO room_blackouts (
           id, room_id, starts_at, ends_at, reason, created_by, created_at
         ) VALUES (
           'blackout_test', 'room_media_studio', '2026-10-30T14:00:00.000Z',
           '2026-10-30T18:00:00.000Z', 'Acoustic panel repair', 'usr_rowan_ellis',
           '2026-10-28T12:00:00.000Z'
         )`,
      )
      .run();

    await cancelOwnBooking(testDatabase.db, amelia, {
      bookingId: "booking_pending_media",
      reason: "Radio show moved to next week.",
    });

    expect(await status(testDatabase, "booking_pending_media_overlap")).toBe("waitlisted");
  });

  it("lets a reviewer decline a waitlisted request but never approve it directly", async () => {
    await decideBooking(testDatabase.db, priya, {
      bookingId: "booking_pending_media",
      action: "approve",
      decisionReason: "First in line under the studio's rule.",
      ...MEDIA_OVERRIDE,
    });

    const approve = await decideBooking(testDatabase.db, priya, {
      bookingId: "booking_pending_media_overlap",
      action: "approve",
      decisionReason: "Trying to approve from the waitlist.",
      ...MEDIA_OVERRIDE,
    });
    expect(approve).toMatchObject({ ok: false, kind: "already_decided" });

    const decline = await decideBooking(testDatabase.db, priya, {
      bookingId: "booking_pending_media_overlap",
      action: "reject",
      decisionReason: "Studio is reserved for the festival all week.",
      overrideRequirementIds: [],
      overrideReason: "",
    });
    expect(decline).toMatchObject({ ok: true, receipt: { status: "rejected" } });
  });

  it("blocks approval inside a closure in the service and in the database", async () => {
    await testDatabase.db
      .prepare(
        `INSERT INTO room_blackouts (
           id, room_id, starts_at, ends_at, reason, created_by, created_at
         ) VALUES (
           'blackout_seminar', 'room_seminar_02', '2026-11-02T12:00:00.000Z',
           '2026-11-02T15:00:00.000Z', 'Fire alarm testing', 'usr_rowan_ellis',
           '2026-10-28T12:00:00.000Z'
         )`,
      )
      .run();

    const result = await decideBooking(testDatabase.db, marcus, {
      bookingId: "booking_pending_seminar",
      action: "approve",
      decisionReason: "Robotics workshop planning is fine.",
      overrideRequirementIds: [],
      overrideReason: "",
    });
    expect(result).toMatchObject({ ok: false, kind: "room_unavailable" });
    if (!result.ok && result.kind === "room_unavailable") {
      expect(result.message).toContain("Fire alarm testing");
    }

    await expect(
      testDatabase.db
        .prepare(
          `UPDATE bookings
           SET status = 'approved', decided_by = 'usr_marcus_webb',
               decided_at = '2026-10-28T12:00:00.000Z',
               decision_reason = 'Bypassing the service layer.'
           WHERE id = 'booking_pending_seminar'`,
        )
        .run(),
    ).rejects.toThrow(/ROOM_BLACKOUT/);
  });

  it("lets the assigned manager cancel a booking with a reason, and nobody else", async () => {
    const outsider = await cancelBookingAsStaff(testDatabase.db, priya, {
      bookingId: "booking_approved_seminar",
      reason: "Trying to cancel another manager's booking.",
    });
    expect(outsider).toMatchObject({ ok: false, kind: "not_found" });

    const student = await cancelBookingAsStaff(testDatabase.db, amelia, {
      bookingId: "booking_approved_seminar",
      reason: "Students cannot use the staff path.",
    });
    expect(student).toMatchObject({ ok: false, kind: "forbidden" });

    const result = await cancelBookingAsStaff(testDatabase.db, marcus, {
      bookingId: "booking_approved_seminar",
      reason: "Emergency maintenance on the projector wiring.",
    });
    expect(result).toMatchObject({ ok: true, receipt: { priorStatus: "approved" } });

    const row = await testDatabase.db
      .prepare("SELECT status, cancelled_by FROM bookings WHERE id = ?")
      .get("booking_approved_seminar") as { status: string; cancelled_by: string };
    expect(row).toEqual({ status: "cancelled", cancelled_by: marcus.id });

    const inbox = await notificationsFor(testDatabase, amelia.id);
    expect(inbox.at(-1)).toMatchObject({ kind: "booking_cancelled_by_staff" });
    expect(inbox.at(-1)?.body).toContain("Emergency maintenance");
  });

  it("still rejects a staff cancellation recorded by an unrelated account at the database", async () => {
    await expect(
      testDatabase.db
        .prepare(
          `UPDATE bookings
           SET status = 'cancelled', cancelled_by = 'usr_noah_williams',
               cancelled_at = '2026-10-28T12:00:00.000Z',
               cancellation_reason = 'Not my booking to cancel.'
           WHERE id = 'booking_approved_seminar'`,
        )
        .run(),
    ).rejects.toThrow(/INVALID_CANCELLATION_METADATA/);
  });
});

describe("joining a waitlist and request limits", () => {
  let testDatabase: SeededTestDatabase;
  let amelia: Profile;
  let noah: Profile;

  beforeEach(async () => {
    testDatabase = await createSeededTestDatabase(fixedNow);
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    clearRateLimitsForTests();
    amelia = await getTestProfile(testDatabase.db, "usr_amelia_chen");
    noah = await getTestProfile(testDatabase.db, "usr_noah_williams");
  });

  afterEach(() => {
    clearRateLimitsForTests();
    vi.useRealTimers();
    testDatabase.cleanup();
  });

  it("offers the waitlist for a booked time and joins it on request", async () => {
    const key = randomUUID();
    const first = await submitBookingRequest(
      testDatabase.db,
      noah,
      submission({ idempotencyKey: key }),
    );

    expect(first).toMatchObject({ ok: false, kind: "conflict", waitlistAvailable: true });

    const joined = await submitBookingRequest(
      testDatabase.db,
      noah,
      submission({ idempotencyKey: key, joinWaitlist: "on" }),
    );

    expect(joined).toMatchObject({ ok: true, kind: "created", receipt: { status: "waitlisted" } });
    if (!joined.ok) return;

    const row = await testDatabase.db
      .prepare("SELECT status, waitlisted_at FROM bookings WHERE id = ?")
      .get(joined.receipt.id) as { status: string; waitlisted_at: string | null };
    expect(row).toEqual({ status: "waitlisted", waitlisted_at: fixedNow.toISOString() });

    const duplicate = await submitBookingRequest(
      testDatabase.db,
      noah,
      submission({ joinWaitlist: "on" }),
    );
    expect(duplicate).toMatchObject({ ok: false, kind: "duplicate" });

    // Waitlist joins do not ping the manager: nothing is actionable yet.
    expect(
      (await notificationsFor(testDatabase, "usr_marcus_webb")).filter(
        (item) => item.booking_id === joined.receipt.id,
      ),
    ).toHaveLength(0);
  });

  it("does not offer a waitlist when the room has turned it off", async () => {
    await testDatabase.db
      .prepare("UPDATE room_booking_policies SET waitlist_enabled = 0 WHERE room_id = 'room_seminar_02'")
      .run();

    const result = await submitBookingRequest(
      testDatabase.db,
      noah,
      submission({ joinWaitlist: "on" }),
    );

    expect(result).toMatchObject({ ok: false, kind: "conflict", waitlistAvailable: false });
  });

  it("notifies the room manager about a new pending request", async () => {
    const result = await submitBookingRequest(
      testDatabase.db,
      noah,
      submission({ startTime: "10:00", endTime: "11:00" }),
    );

    expect(result.ok).toBe(true);
    const inbox = await notificationsFor(testDatabase, "usr_marcus_webb");
    expect(inbox.at(-1)).toMatchObject({ kind: "request_submitted" });
    expect(inbox.at(-1)?.title).toBe("New request: Seminar Room 02");
  });

  it("enforces the booking horizon", async () => {
    await testDatabase.db
      .prepare("UPDATE room_booking_policies SET max_advance_days = 3 WHERE room_id = 'room_seminar_02'")
      .run();

    const result = await submitBookingRequest(
      testDatabase.db,
      noah,
      submission({ startDate: "2026-11-05", startTime: "10:00", endTime: "11:00" }),
    );

    expect(result).toMatchObject({
      ok: false,
      kind: "validation",
      fieldErrors: { startDate: "This room takes requests up to 3 days ahead." },
    });
  });

  it("enforces the per-person cap on upcoming requests", async () => {
    await testDatabase.db
      .prepare(
        "UPDATE room_booking_policies SET max_active_per_requester = 2 WHERE room_id = 'room_seminar_02'",
      )
      .run();

    // Amelia already holds an approved and a pending Seminar Room request.
    const result = await submitBookingRequest(
      testDatabase.db,
      amelia,
      submission({ startTime: "10:00", endTime: "11:00" }),
    );

    expect(result).toMatchObject({ ok: false, kind: "quota" });
  });

  it("refuses requests during a closure and suggests open times", async () => {
    await testDatabase.db
      .prepare(
        `INSERT INTO room_blackouts (
           id, room_id, starts_at, ends_at, reason, created_by, created_at
         ) VALUES (
           'blackout_seminar_morning', 'room_seminar_02', '2026-10-29T08:00:00.000Z',
           '2026-10-29T12:00:00.000Z', 'Carpet replacement', 'usr_rowan_ellis',
           '2026-10-28T12:00:00.000Z'
         )`,
      )
      .run();

    const result = await submitBookingRequest(
      testDatabase.db,
      noah,
      submission({ startTime: "10:00", endTime: "11:00" }),
    );

    expect(result).toMatchObject({ ok: false, kind: "blackout" });
    if (result.ok || result.kind !== "blackout") return;
    expect(result.message).toContain("Carpet replacement");
    expect(result.alternatives.length).toBeGreaterThan(0);
    for (const alternative of result.alternatives) {
      const overlapsClosure =
        alternative.date === "2026-10-29" && alternative.startTime < "12:00";
      expect(overlapsClosure).toBe(false);
    }
  });

  it("applies the changeover buffer after every booking, not only the first approved", async () => {
    await testDatabase.db
      .prepare("UPDATE room_booking_policies SET buffer_minutes = 15 WHERE room_id = 'room_seminar_02'")
      .run();

    // The approved booking starts at 16:00. A booking ending exactly at 16:00
    // leaves no changeover time, so it conflicts.
    const endsAtStart = await submitBookingRequest(
      testDatabase.db,
      noah,
      submission({ startTime: "15:00", endTime: "16:00" }),
    );
    expect(endsAtStart).toMatchObject({ ok: false, kind: "conflict" });

    const leavesGap = await submitBookingRequest(
      testDatabase.db,
      noah,
      submission({ startTime: "14:30", endTime: "15:30" }),
    );
    expect(leavesGap).toMatchObject({ ok: true });
  });

  it("lets a requester leave the waitlist", async () => {
    const joined = await submitBookingRequest(
      testDatabase.db,
      noah,
      submission({ joinWaitlist: "on" }),
    );
    if (!joined.ok) throw new Error("expected a waitlist join");

    const left = await cancelOwnBooking(testDatabase.db, noah, {
      bookingId: joined.receipt.id,
      reason: "Found another room.",
    });

    expect(left).toMatchObject({
      ok: true,
      receipt: { priorStatus: "waitlisted", promotedCount: 0 },
    });
  });
});
