import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProfileById } from "@/lib/auth/service";
import { decideBooking } from "@/lib/bookings/decisions";
import {
  getManagerRequest,
  listManagerQueue,
} from "@/lib/bookings/manager-queries";
import { createSeededTestDatabase } from "./helpers";

type SeededTestDatabase = Awaited<ReturnType<typeof createSeededTestDatabase>>;

const fixedNow = new Date("2026-10-28T12:00:00.000Z");
const defaultFilters = {
  status: "pending" as const,
  roomCode: "",
  date: "",
  eligibility: "all" as const,
  conflict: "all" as const,
  page: 1,
};

function auditCount(testDatabase: SeededTestDatabase): number {
  return (
    testDatabase.db
      .prepare("SELECT count(*) AS count FROM audit_events")
      .get() as { count: number }
  ).count;
}

describe("manager queue and decisions", () => {
  let testDatabase: SeededTestDatabase;
  let priya: NonNullable<ReturnType<typeof getProfileById>>;
  let marcus: NonNullable<ReturnType<typeof getProfileById>>;
  let admin: NonNullable<ReturnType<typeof getProfileById>>;
  let student: NonNullable<ReturnType<typeof getProfileById>>;

  beforeEach(async () => {
    testDatabase = await createSeededTestDatabase(fixedNow);
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    priya = getProfileById(testDatabase.db, "usr_priya_nair")!;
    marcus = getProfileById(testDatabase.db, "usr_marcus_webb")!;
    admin = getProfileById(testDatabase.db, "usr_rowan_ellis")!;
    student = getProfileById(testDatabase.db, "usr_amelia_chen")!;
  });

  afterEach(() => {
    vi.useRealTimers();
    testDatabase.cleanup();
  });

  it("scopes the queue by room assignment and lets admin see all rooms", () => {
    const priyaQueue = listManagerQueue(
      testDatabase.db,
      priya,
      defaultFilters,
    );
    const marcusQueue = listManagerQueue(
      testDatabase.db,
      marcus,
      defaultFilters,
    );
    const adminQueue = listManagerQueue(
      testDatabase.db,
      admin,
      defaultFilters,
    );
    const studentQueue = listManagerQueue(
      testDatabase.db,
      student,
      defaultFilters,
    );

    expect(priyaQueue.items.map((item) => item.id)).toEqual([
      "booking_pending_media",
      "booking_pending_media_overlap",
    ]);
    expect(priyaQueue.counts.pending).toBe(2);
    expect(priyaQueue.items.every((item) => item.pendingOverlapCount === 1)).toBe(
      true,
    );

    expect(marcusQueue.items.map((item) => item.id)).toEqual([
      "booking_pending_seminar",
    ]);
    expect(marcusQueue.counts.pending).toBe(1);

    expect(adminQueue.items).toHaveLength(3);
    expect(adminQueue.counts.pending).toBe(3);

    expect(studentQueue.items).toEqual([]);
    expect(studentQueue.rooms).toEqual([]);
  });

  it("filters the scoped queue by eligibility and overlap state", () => {
    const eligibilityReview = listManagerQueue(testDatabase.db, priya, {
      ...defaultFilters,
      eligibility: "needs_review",
    });
    const overlaps = listManagerQueue(testDatabase.db, priya, {
      ...defaultFilters,
      conflict: "any",
    });
    const marcusReview = listManagerQueue(testDatabase.db, marcus, {
      ...defaultFilters,
      eligibility: "needs_review",
    });

    expect(eligibilityReview.items).toHaveLength(2);
    expect(overlaps.items).toHaveLength(2);
    expect(marcusReview.items).toHaveLength(0);
  });

  it("returns safe not-found for cross-room detail access", () => {
    expect(
      getManagerRequest(testDatabase.db, priya, "booking_pending_seminar"),
    ).toBeNull();
    expect(
      getManagerRequest(testDatabase.db, marcus, "booking_pending_media"),
    ).toBeNull();
    expect(
      getManagerRequest(testDatabase.db, admin, "booking_pending_media"),
    ).not.toBeNull();
    expect(
      getManagerRequest(testDatabase.db, student, "booking_pending_media"),
    ).toBeNull();
  });

  it("approves a valid pending request and writes one audit event", () => {
    const before = auditCount(testDatabase);
    const result = decideBooking(testDatabase.db, marcus, {
      bookingId: "booking_pending_seminar",
      action: "approve",
      decisionReason: "The request meets current room policy and eligibility.",
      overrideRequirementIds: [],
      overrideReason: "",
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "decided",
      receipt: { status: "approved" },
    });

    const row = testDatabase.db
      .prepare(
        "SELECT status, decided_by, decision_reason, eligibility_override_reason FROM bookings WHERE id = 'booking_pending_seminar'",
      )
      .get() as {
      status: string;
      decided_by: string;
      decision_reason: string;
      eligibility_override_reason: string | null;
    };

    expect(row).toMatchObject({
      status: "approved",
      decided_by: "usr_marcus_webb",
      eligibility_override_reason: null,
    });
    expect(auditCount(testDatabase)).toBe(before + 1);
  });

  it("blocks a second decision and does not append another success event", () => {
    const reason = "The request meets current room policy and eligibility.";
    const first = decideBooking(testDatabase.db, marcus, {
      bookingId: "booking_pending_seminar",
      action: "approve",
      decisionReason: reason,
      overrideRequirementIds: [],
      overrideReason: "",
    });
    expect(first.ok).toBe(true);
    const afterFirst = auditCount(testDatabase);

    const second = decideBooking(testDatabase.db, marcus, {
      bookingId: "booking_pending_seminar",
      action: "reject",
      decisionReason: "Trying to replace the first decision.",
      overrideRequirementIds: [],
      overrideReason: "",
    });

    expect(second).toMatchObject({
      ok: false,
      kind: "already_decided",
      currentStatus: "approved",
    });
    expect(auditCount(testDatabase)).toBe(afterFirst);
  });

  it("rejects a pending request with a requester-visible reason", () => {
    const result = decideBooking(testDatabase.db, priya, {
      bookingId: "booking_pending_media",
      action: "reject",
      decisionReason: "The equipment induction is not verified for this booking.",
      overrideRequirementIds: [],
      overrideReason: "",
    });

    expect(result).toMatchObject({
      ok: true,
      receipt: { status: "rejected" },
    });

    const row = testDatabase.db
      .prepare(
        "SELECT status, decided_by, decision_reason FROM bookings WHERE id = 'booking_pending_media'",
      )
      .get() as {
      status: string;
      decided_by: string;
      decision_reason: string;
    };

    expect(row).toEqual({
      status: "rejected",
      decided_by: "usr_priya_nair",
      decision_reason:
        "The equipment induction is not verified for this booking.",
    });
  });

  it("requires an override for an unsatisfied mandatory requirement", () => {
    const before = auditCount(testDatabase);
    const result = decideBooking(testDatabase.db, priya, {
      bookingId: "booking_pending_media",
      action: "approve",
      decisionReason: "The rest of the request meets room policy.",
      overrideRequirementIds: [],
      overrideReason: "",
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "eligibility_required",
    });
    expect(auditCount(testDatabase)).toBe(before);

    const row = testDatabase.db
      .prepare("SELECT status FROM bookings WHERE id = 'booking_pending_media'")
      .get() as { status: string };
    expect(row.status).toBe("pending");
  });

  it("records a one-booking eligibility override without changing profile eligibility", () => {
    const result = decideBooking(testDatabase.db, priya, {
      bookingId: "booking_pending_media",
      action: "approve",
      decisionReason: "Approved after a manual review of the booking context.",
      overrideRequirementIds: ["req_media_equipment_induction"],
      overrideReason:
        "The manager confirmed equivalent induction for this specific booking.",
    });

    expect(result).toMatchObject({ ok: true, receipt: { status: "approved" } });

    const row = testDatabase.db
      .prepare(
        `SELECT status, eligibility_override_reason,
                eligibility_override_requirement_ids_json
         FROM bookings WHERE id = 'booking_pending_media'`,
      )
      .get() as {
      status: string;
      eligibility_override_reason: string;
      eligibility_override_requirement_ids_json: string;
    };

    expect(row.status).toBe("approved");
    expect(row.eligibility_override_reason).toMatch(/equivalent induction/);
    expect(JSON.parse(row.eligibility_override_requirement_ids_json)).toEqual([
      "req_media_equipment_induction",
    ]);

    const eligibility = testDatabase.db
      .prepare(
        "SELECT status FROM profile_eligibility WHERE profile_id = 'usr_amelia_chen' AND requirement_id = 'req_media_equipment_induction'",
      )
      .get() as { status: string };
    expect(eligibility.status).toBe("unverified");
  });

  it("rejects an invalid override selection", () => {
    const result = decideBooking(testDatabase.db, priya, {
      bookingId: "booking_pending_media",
      action: "approve",
      decisionReason: "Approved after a manual review of the booking context.",
      overrideRequirementIds: ["req_seminar_club_briefing"],
      overrideReason:
        "The manager confirmed equivalent induction for this specific booking.",
    });

    expect(result).toMatchObject({ ok: false, kind: "validation" });
  });

  it("blocks a newly confirmed conflict and leaves the request pending", () => {
    const pending = testDatabase.db
      .prepare(
        "SELECT room_id, start_at, end_at FROM bookings WHERE id = 'booking_pending_seminar'",
      )
      .get() as { room_id: string; start_at: string; end_at: string };

    testDatabase.db
      .prepare(
        `INSERT INTO bookings (
           id, room_id, requester_id, purpose, expected_attendance,
           start_at, end_at, status, created_at, updated_at,
           decided_by, decided_at, decision_reason
         ) VALUES (
           'booking_conflict_created_later', ?, 'usr_noah_williams',
           'A later confirmed booking', 4, ?, ?, 'approved',
           '2026-10-28T12:00:00.000Z', '2026-10-28T12:00:00.000Z',
           'usr_marcus_webb', '2026-10-28T12:00:00.000Z',
           'Test fixture confirmed booking.'
         )`,
      )
      .run(pending.room_id, pending.start_at, pending.end_at);

    const before = auditCount(testDatabase);
    const result = decideBooking(testDatabase.db, marcus, {
      bookingId: "booking_pending_seminar",
      action: "approve",
      decisionReason: "The request meets current room policy and eligibility.",
      overrideRequirementIds: [],
      overrideReason: "",
    });

    expect(result).toMatchObject({ ok: false, kind: "conflict" });
    expect(auditCount(testDatabase)).toBe(before);

    const row = testDatabase.db
      .prepare("SELECT status FROM bookings WHERE id = 'booking_pending_seminar'")
      .get() as { status: string };
    expect(row.status).toBe("pending");
  });

  it("blocks approval when the room is no longer active", () => {
    testDatabase.db
      .prepare("UPDATE rooms SET status = 'inactive' WHERE id = 'room_seminar_02'")
      .run();

    const result = decideBooking(testDatabase.db, marcus, {
      bookingId: "booking_pending_seminar",
      action: "approve",
      decisionReason: "The request meets current room policy and eligibility.",
      overrideRequirementIds: [],
      overrideReason: "",
    });

    expect(result).toMatchObject({ ok: false, kind: "room_unavailable" });
  });

  it("lets an admin decide a request outside their room portfolio", () => {
    const result = decideBooking(testDatabase.db, admin, {
      bookingId: "booking_pending_media",
      action: "reject",
      decisionReason: "Admin review found the request cannot be accommodated.",
      overrideRequirementIds: [],
      overrideReason: "",
    });

    expect(result).toMatchObject({
      ok: true,
      receipt: { status: "rejected" },
    });

    const row = testDatabase.db
      .prepare(
        "SELECT status, decided_by FROM bookings WHERE id = 'booking_pending_media'",
      )
      .get() as { status: string; decided_by: string };
    expect(row).toEqual({
      status: "rejected",
      decided_by: "usr_rowan_ellis",
    });
  });

  it("requires a meaningful decision reason", () => {
    const result = decideBooking(testDatabase.db, marcus, {
      bookingId: "booking_pending_seminar",
      action: "approve",
      decisionReason: "Too short",
      overrideRequirementIds: [],
      overrideReason: "",
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "validation",
      fieldErrors: { decisionReason: expect.any(String) },
    });
  });

  it("prevents an unassigned manager from deciding", () => {
    const result = decideBooking(testDatabase.db, priya, {
      bookingId: "booking_pending_seminar",
      action: "approve",
      decisionReason: "The request meets current room policy and eligibility.",
      overrideRequirementIds: [],
      overrideReason: "",
    });

    expect(result).toMatchObject({ ok: false, kind: "not_found" });
  });
});
