import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProfileById } from "@/lib/auth/service";
import { getBookingTimeline } from "@/lib/bookings/timeline";
import {
  getIncidentDetail,
  listIncidents,
  parseIncidentFilters,
} from "@/lib/incidents/queries";
import {
  resolveIncident,
  reviewIncident,
} from "@/lib/incidents/service";
import { createSeededTestDatabase } from "./helpers";

type SeededTestDatabase = Awaited<ReturnType<typeof createSeededTestDatabase>>;

const fixedNow = new Date("2026-10-28T12:00:00.000Z");
const defaultFilters = {
  status: "active" as const,
  roomCode: "",
  category: "" as const,
  date: "",
  page: 1,
};

function countAudit(testDatabase: SeededTestDatabase): number {
  return (
    testDatabase.db
      .prepare("SELECT count(*) AS count FROM audit_events")
      .get() as { count: number }
  ).count;
}

describe("incident review and close-out", () => {
  let testDatabase: SeededTestDatabase;
  let student: NonNullable<ReturnType<typeof getProfileById>>;
  let otherStudent: NonNullable<ReturnType<typeof getProfileById>>;
  let priya: NonNullable<ReturnType<typeof getProfileById>>;
  let marcus: NonNullable<ReturnType<typeof getProfileById>>;
  let admin: NonNullable<ReturnType<typeof getProfileById>>;

  beforeEach(async () => {
    testDatabase = await createSeededTestDatabase(fixedNow);
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    student = getProfileById(testDatabase.db, "usr_amelia_chen")!;
    otherStudent = getProfileById(testDatabase.db, "usr_noah_williams")!;
    priya = getProfileById(testDatabase.db, "usr_priya_nair")!;
    marcus = getProfileById(testDatabase.db, "usr_marcus_webb")!;
    admin = getProfileById(testDatabase.db, "usr_rowan_ellis")!;
  });

  afterEach(() => {
    vi.useRealTimers();
    testDatabase.cleanup();
  });

  it("scopes the incident queue to assigned rooms and admin", () => {
    const priyaQueue = listIncidents(testDatabase.db, priya, defaultFilters);
    const marcusQueue = listIncidents(testDatabase.db, marcus, defaultFilters);
    const adminQueue = listIncidents(testDatabase.db, admin, defaultFilters);
    const studentQueue = listIncidents(testDatabase.db, student, defaultFilters);

    expect(priyaQueue.items.map((item) => item.id)).toEqual([
      "incident_light_reviewing",
      "incident_equipment_open",
    ]);
    expect(marcusQueue.items).toEqual([]);
    expect(adminQueue.items).toHaveLength(2);
    expect(studentQueue.items).toEqual([]);
  });

  it("lets the assigned manager start a review but not resolve", () => {
    const beforeAudit = countAudit(testDatabase);
    const review = reviewIncident(testDatabase.db, priya, {
      incidentId: "incident_equipment_open",
      note: "The missing stand was confirmed during the handover review.",
    });

    expect(review).toMatchObject({
      ok: true,
      receipt: { status: "reviewing" },
    });
    expect(countAudit(testDatabase)).toBe(beforeAudit + 1);

    const row = testDatabase.db
      .prepare(
        `SELECT status, manager_reviewed_by, manager_review_note
         FROM incidents WHERE id = 'incident_equipment_open'`,
      )
      .get() as {
      status: string;
      manager_reviewed_by: string;
      manager_review_note: string;
    };
    expect(row).toMatchObject({
      status: "reviewing",
      manager_reviewed_by: "usr_priya_nair",
    });

    const resolveAttempt = resolveIncident(testDatabase.db, priya, {
      incidentId: "incident_equipment_open",
      resolutionNote: "Managers cannot finalize this incident.",
    });
    expect(resolveAttempt).toMatchObject({ ok: false, kind: "forbidden" });
  });

  it("does not let an unassigned manager read or review the incident", () => {
    expect(
      getIncidentDetail(testDatabase.db, marcus, "incident_equipment_open"),
    ).toBeNull();
    expect(
      reviewIncident(testDatabase.db, marcus, {
        incidentId: "incident_equipment_open",
        note: "An unassigned manager should not reach this review.",
      }),
    ).toMatchObject({ ok: false, kind: "not_found" });
  });

  it("lets an admin resolve and complete the booking when no other incident remains", () => {
    const beforeAudit = countAudit(testDatabase);
    const result = resolveIncident(testDatabase.db, admin, {
      incidentId: "incident_equipment_open",
      resolutionNote:
        "The equipment set was checked and the missing stand was replaced.",
    });

    expect(result).toMatchObject({
      ok: true,
      receipt: {
        status: "resolved",
        bookingCompleted: true,
      },
    });
    expect(countAudit(testDatabase)).toBe(beforeAudit + 2);

    const booking = testDatabase.db
      .prepare(
        "SELECT status, closed_at, closure_reason FROM bookings WHERE id = 'booking_incident_open'",
      )
      .get() as {
      status: string;
      closed_at: string;
      closure_reason: string;
    };
    expect(booking.status).toBe("completed");
    expect(booking.closed_at).toBeTruthy();
    expect(booking.closure_reason).toBe("incident_resolved");
  });

  it("keeps the booking in incident state until all incidents resolve", () => {
    testDatabase.db
      .prepare(
        `INSERT INTO incidents (
           id, booking_id, category, description, status, reporter_id,
           reviewer_id, resolution_note, created_at, updated_at,
           manager_reviewed_by, manager_reviewed_at, manager_review_note,
           resolved_at
         ) VALUES (
           'incident_second_open', 'booking_incident_open', 'safety',
           'A second demo issue for the same booking.', 'open',
           'usr_amelia_chen', NULL, NULL,
           '2026-10-22T12:00:00.000Z', '2026-10-22T12:00:00.000Z',
           NULL, NULL, NULL, NULL
         )`,
      )
      .run();

    const first = resolveIncident(testDatabase.db, admin, {
      incidentId: "incident_equipment_open",
      resolutionNote: "The missing stand was replaced after review.",
    });
    expect(first).toMatchObject({
      ok: true,
      receipt: { bookingCompleted: false },
    });

    const during = testDatabase.db
      .prepare(
        "SELECT status FROM bookings WHERE id = 'booking_incident_open'",
      )
      .get() as { status: string };
    expect(during.status).toBe("incident");

    const second = resolveIncident(testDatabase.db, admin, {
      incidentId: "incident_second_open",
      resolutionNote: "The second issue was reviewed and cleared by admin.",
    });
    expect(second).toMatchObject({
      ok: true,
      receipt: { bookingCompleted: true },
    });

    const after = testDatabase.db
      .prepare(
        "SELECT status FROM bookings WHERE id = 'booking_incident_open'",
      )
      .get() as { status: string };
    expect(after.status).toBe("completed");
  });

  it("lets the requester read their own incident but not another user's", () => {
    expect(
      getIncidentDetail(
        testDatabase.db,
        student,
        "incident_equipment_open",
      ),
    ).not.toBeNull();
    expect(
      getIncidentDetail(
        testDatabase.db,
        student,
        "incident_light_reviewing",
      ),
    ).toBeNull();
    expect(
      getIncidentDetail(
        testDatabase.db,
        otherStudent,
        "incident_light_reviewing",
      ),
    ).not.toBeNull();
  });

  it("provides a role-scoped booking timeline with access and close-out events", () => {
    const timeline = getBookingTimeline(
      testDatabase.db,
      student,
      "booking_completed_seminar",
    );

    expect(timeline).not.toBeNull();
    const titles = timeline?.entries.map((entry) => entry.title) ?? [];
    expect(titles).toContain("Request submitted");
    expect(titles).toContain("Request approved");
    expect(titles).toContain("Simulated access allowed");
    expect(titles).toContain("Check-out condition reported");
    expect(
      getBookingTimeline(
        testDatabase.db,
        priya,
        "booking_incident_open",
      ),
    ).not.toBeNull();
    expect(
      getBookingTimeline(
        testDatabase.db,
        marcus,
        "booking_incident_open",
      ),
    ).toBeNull();
  });

  it("parses incident filters safely", () => {
    const parsed = parseIncidentFilters({
      status: "reviewing",
      room: "MED-01",
      category: "equipment",
      date: "2026-10-28",
    });

    expect(parsed.error).toBeUndefined();
    expect(parsed.filters).toMatchObject({
      status: "reviewing",
      roomCode: "MED-01",
      category: "equipment",
      date: "2026-10-28",
    });
  });
});
