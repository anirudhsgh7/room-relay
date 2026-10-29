import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addBlackout,
  blackoutLabel,
  createRoom,
  getAdminRoom,
  listAdminRooms,
  removeBlackout,
  updateRoomDetails,
  updateRoomHours,
  updateRoomPolicy,
  type PolicyInput,
  type WeekdayHours,
} from "@/lib/admin/rooms";
import type { UserProfile } from "@/lib/auth/service";
import { decideBooking } from "@/lib/bookings/decisions";
import { seedDatabase } from "@/lib/db/seed";
import { getRoomDetail } from "@/lib/rooms/queries";
import { createSeededTestDatabase, getTestProfile } from "./helpers";

type SeededTestDatabase = Awaited<ReturnType<typeof createSeededTestDatabase>>;
type Profile = UserProfile;

const fixedNow = new Date("2026-10-28T12:00:00.000Z");

const seminarDetails = {
  name: "Seminar Room 02",
  building: "Hazelwood Hall",
  location: "Second floor, east wing",
  capacity: "18",
  facilities: "Projector, Whiteboard, Hybrid meeting kit",
  policySummary: "Student clubs and course groups.",
  managerId: "usr_marcus_webb",
  status: "active",
};

const defaultPolicy: PolicyInput = {
  requestsEnabled: true,
  waitlistEnabled: true,
  slotIntervalMinutes: 30,
  minimumNoticeMinutes: 30,
  maximumDurationMinutes: 240,
  bufferMinutes: 0,
  maxAdvanceDays: 60,
  maxActivePerRequester: 0,
  allocationRule: "first_come",
};

function weekdays(opensAt: string, closesAt: string): WeekdayHours[] {
  return [1, 2, 3, 4, 5, 6, 0].map((weekday) => ({
    weekday,
    open: weekday >= 1 && weekday <= 5,
    opensAt,
    closesAt,
  }));
}

async function status(testDatabase: SeededTestDatabase, id: string): Promise<string> {
  return (
    (await testDatabase.db
      .prepare("SELECT status FROM bookings WHERE id = ?")
      .get(id)) as { status: string }
  ).status;
}

describe("room administration", () => {
  let testDatabase: SeededTestDatabase;
  let admin: Profile;
  let marcus: Profile;
  let priya: Profile;
  let amelia: Profile;

  beforeEach(async () => {
    testDatabase = await createSeededTestDatabase(fixedNow);
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    admin = await getTestProfile(testDatabase.db, "usr_rowan_ellis");
    marcus = await getTestProfile(testDatabase.db, "usr_marcus_webb");
    priya = await getTestProfile(testDatabase.db, "usr_priya_nair");
    amelia = await getTestProfile(testDatabase.db, "usr_amelia_chen");
  });

  afterEach(() => {
    vi.useRealTimers();
    testDatabase.cleanup();
  });

  it("scopes the room list: admins see every room, managers their own, students none", async () => {
    expect(await listAdminRooms(testDatabase.db, admin)).toHaveLength(5);
    expect((await listAdminRooms(testDatabase.db, marcus)).map((room) => room.code).sort()).toEqual([
      "ARC-B1",
      "NEW-14",
      "SEM-02",
    ]);
    expect(await listAdminRooms(testDatabase.db, amelia)).toEqual([]);
    expect(await getAdminRoom(testDatabase.db, priya, "room_seminar_02")).toBeNull();
  });

  it("gives a room's manager hours, rules, and closures but not details or status", async () => {
    const access = await getAdminRoom(testDatabase.db, marcus, "room_seminar_02");

    expect(access?.permissions).toEqual({
      canEditDetails: false,
      canAssignManager: false,
      canChangeStatus: false,
      canEditHours: true,
      canEditPolicy: true,
      canManageBlackouts: true,
    });

    const result = await updateRoomDetails(testDatabase.db, marcus, "room_seminar_02", {
      ...seminarDetails,
      capacity: "200",
    });
    expect(result).toMatchObject({ ok: false, kind: "forbidden" });
  });

  it("creates a bookable room with default hours and a policy, and tells its manager", async () => {
    const result = await createRoom(testDatabase.db, admin, {
      code: "lab-07",
      name: "Maker Lab 07",
      building: "Engineering Block",
      location: "Ground floor",
      capacity: "12",
      facilities: "3D printers, Workbenches,  workbenches ",
      policySummary: "Safety glasses required.",
      managerId: "usr_priya_nair",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const room = await getRoomDetail(testDatabase.db, amelia, "LAB-07", null);
    expect(room).toMatchObject({
      code: "LAB-07",
      facilities: ["3D printers", "Workbenches"],
      policy: { requestsEnabled: true, allocationRule: "first_come", waitlistEnabled: true },
    });
    expect(room?.hours.map((rule) => rule.weekday)).toEqual([1, 2, 3, 4, 5]);

    const notice = await testDatabase.db
      .prepare("SELECT kind, title FROM notifications WHERE recipient_id = 'usr_priya_nair'")
      .get() as { kind: string; title: string };
    expect(notice).toEqual({ kind: "room_assignment", title: "You now manage Maker Lab 07" });
  });

  it("rejects duplicate codes, non-manager assignees, and non-admin creators", async () => {
    const base = {
      code: "SEM-02",
      name: "Duplicate",
      building: "Somewhere",
      location: "Somewhere",
      capacity: "5",
      facilities: "",
      policySummary: "",
      managerId: "usr_marcus_webb",
    };

    expect(await createRoom(testDatabase.db, admin, base)).toMatchObject({
      ok: false,
      fieldErrors: { code: expect.stringContaining("already in use") },
    });
    expect(
      await createRoom(testDatabase.db, admin, { ...base, code: "NEW-99", managerId: "usr_amelia_chen" }),
    ).toMatchObject({ ok: false, fieldErrors: { managerId: expect.any(String) } });
    expect(await createRoom(testDatabase.db, marcus, { ...base, code: "NEW-99" })).toMatchObject({
      ok: false,
      kind: "forbidden",
    });
  });

  it("reassigns a room so its pending requests move to the new manager's queue", async () => {
    const result = await updateRoomDetails(testDatabase.db, admin, "room_seminar_02", {
      ...seminarDetails,
      managerId: "usr_priya_nair",
    });
    expect(result.ok).toBe(true);

    const decision = await decideBooking(testDatabase.db, priya, {
      bookingId: "booking_pending_seminar",
      action: "approve",
      decisionReason: "New manager approving the workshop.",
      overrideRequirementIds: [],
      overrideReason: "",
    });
    expect(decision).toMatchObject({ ok: true });

    const kinds = await testDatabase.db
      .prepare("SELECT recipient_id, kind FROM notifications WHERE kind = 'room_assignment' ORDER BY recipient_id")
      .all();
    expect(kinds).toEqual([
      { recipient_id: "usr_marcus_webb", kind: "room_assignment" },
      { recipient_id: "usr_priya_nair", kind: "room_assignment" },
    ]);
  });

  it("asks before closing a room with upcoming bookings, then cancels and notifies", async () => {
    const preview = await updateRoomDetails(testDatabase.db, admin, "room_seminar_02", {
      ...seminarDetails,
      status: "inactive",
    });

    expect(preview).toMatchObject({ ok: false, kind: "needs_confirmation" });
    if (preview.ok || preview.kind !== "needs_confirmation") return;
    expect(preview.impact.map((item) => item.id).sort()).toEqual([
      "booking_approved_seminar",
      "booking_pending_seminar",
    ]);
    expect(await status(testDatabase, "booking_approved_seminar")).toBe("approved");

    const confirmed = await updateRoomDetails(testDatabase.db, admin, "room_seminar_02", {
      ...seminarDetails,
      status: "inactive",
      confirmImpact: true,
    });

    expect(confirmed).toMatchObject({ ok: true, cancelledCount: 2 });
    expect(await status(testDatabase, "booking_approved_seminar")).toBe("cancelled");
    expect(await status(testDatabase, "booking_pending_seminar")).toBe("cancelled");
    expect(await getRoomDetail(testDatabase.db, amelia, "SEM-02", null)).toBeNull();
  });

  it("warns about upcoming bookings above a reduced capacity without cancelling them", async () => {
    const result = await updateRoomDetails(testDatabase.db, admin, "room_seminar_02", {
      ...seminarDetails,
      capacity: "12",
    });

    expect(result).toMatchObject({ ok: true, cancelledCount: 0 });
    if (!result.ok) return;
    // The approved Robotics Club booking expects 14; the pending one expects 10.
    expect(result.overCapacity.map((item) => item.id)).toEqual(["booking_approved_seminar"]);
    expect(await status(testDatabase, "booking_approved_seminar")).toBe("approved");
  });

  it("replaces opening hours and flags bookings left outside them", async () => {
    const result = await updateRoomHours(
      testDatabase.db,
      marcus,
      "room_seminar_02",
      weekdays("08:00", "15:00"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Approved booking Thu 16:00–17:30 now falls after closing.
    expect(result.outsideHours.map((item) => item.id)).toEqual(["booking_approved_seminar"]);
    expect(
      (await getAdminRoom(testDatabase.db, admin, "room_seminar_02"))?.room.hours.find(
        (day) => day.weekday === 1,
      ),
    ).toEqual({ weekday: 1, open: true, opensAt: "08:00", closesAt: "15:00" });
  });

  it("rejects opening hours that close before they open", async () => {
    const hours = weekdays("09:00", "17:00");
    hours[0] = { weekday: 1, open: true, opensAt: "18:00", closesAt: "09:00" };

    expect(await updateRoomHours(testDatabase.db, admin, "room_seminar_02", hours)).toMatchObject({
      ok: false,
      kind: "validation",
      message: "Monday: closing time must be after opening time.",
    });
  });

  it("saves structured booking rules and refuses a gap that would clash with approved bookings", async () => {
    const saved = await updateRoomPolicy(testDatabase.db, marcus, "room_seminar_02", {
      ...defaultPolicy,
      allocationRule: "fair_share",
      maxActivePerRequester: 3,
      maxAdvanceDays: 21,
    });
    expect(saved).toMatchObject({
      ok: true,
      policy: { allocationRule: "fair_share", maxActivePerRequester: 3, maxAdvanceDays: 21 },
    });

    // Two approved Classroom 14 bookings 30 minutes apart.
    await testDatabase.db
      .prepare(
        `INSERT INTO bookings (
           id, room_id, requester_id, purpose, expected_attendance, start_at, end_at,
           status, created_at, updated_at, decided_by, decided_at, decision_reason
         ) VALUES (
           'booking_back_to_back', 'room_classroom_14', 'usr_noah_williams',
           'Back-to-back seminar', 10, '2026-10-28T13:15:00.000Z', '2026-10-28T14:00:00.000Z',
           'approved', '2026-10-28T12:00:00.000Z', '2026-10-28T12:00:00.000Z',
           'usr_marcus_webb', '2026-10-28T12:00:00.000Z', 'Approved for the test.'
         )`,
      )
      .run();

    const clash = await updateRoomPolicy(testDatabase.db, admin, "room_classroom_14", {
      ...defaultPolicy,
      bufferMinutes: 60,
    });
    expect(clash).toMatchObject({ ok: false, kind: "conflict" });

    const fits = await updateRoomPolicy(testDatabase.db, admin, "room_classroom_14", {
      ...defaultPolicy,
      bufferMinutes: 30,
    });
    expect(fits).toMatchObject({ ok: true });
  });

  it("rejects booking rules outside the published options", async () => {
    expect(
      await updateRoomPolicy(testDatabase.db, admin, "room_seminar_02", {
        ...defaultPolicy,
        slotIntervalMinutes: 7,
      }),
    ).toMatchObject({ ok: false, kind: "validation" });
    expect(
      await updateRoomPolicy(testDatabase.db, admin, "room_seminar_02", {
        ...defaultPolicy,
        allocationRule: "loudest_voice" as PolicyInput["allocationRule"],
      }),
    ).toMatchObject({ ok: false, kind: "validation" });
  });

  it("previews, adds, and removes a closure, cancelling what it overlaps", async () => {
    const input = {
      startDate: "2026-10-29",
      endDate: "2026-10-29",
      allDay: true,
      reason: "Projector replacement",
    };

    const preview = await addBlackout(testDatabase.db, marcus, "room_seminar_02", input);
    expect(preview).toMatchObject({ ok: false, kind: "needs_confirmation" });
    if (preview.ok || preview.kind !== "needs_confirmation") return;
    expect(preview.impact.map((item) => item.id)).toEqual(["booking_approved_seminar"]);

    const added = await addBlackout(testDatabase.db, marcus, "room_seminar_02", {
      ...input,
      confirmImpact: true,
    });
    expect(added).toMatchObject({ ok: true, cancelledCount: 1 });
    if (!added.ok) return;

    expect(await status(testDatabase, "booking_approved_seminar")).toBe("cancelled");
    const notice = await testDatabase.db
      .prepare(
        "SELECT body FROM notifications WHERE recipient_id = 'usr_amelia_chen' AND kind = 'booking_cancelled_by_staff'",
      )
      .get() as { body: string };
    expect(notice.body).toContain("Room closed: Projector replacement");

    const room = await getRoomDetail(testDatabase.db, amelia, "SEM-02", null);
    expect(room?.upcomingBlackouts).toHaveLength(1);

    const removed = await removeBlackout(testDatabase.db, marcus, "room_seminar_02", added.blackoutId);
    expect(removed).toMatchObject({ ok: true });
    expect((await getRoomDetail(testDatabase.db, amelia, "SEM-02", null))?.upcomingBlackouts).toHaveLength(0);

    await expect(
      testDatabase.db.prepare("DELETE FROM room_blackouts WHERE id = ?").run(added.blackoutId),
    ).rejects.toThrow(/removed, not deleted/);
  });

  it("refuses closures in the past and closures that end before they start", async () => {
    expect(
      await addBlackout(testDatabase.db, admin, "room_seminar_02", {
        startDate: "2026-10-27",
        endDate: "2026-10-27",
        allDay: true,
        reason: "Too late now",
      }),
    ).toMatchObject({ ok: false, kind: "validation" });

    expect(
      await addBlackout(testDatabase.db, admin, "room_seminar_02", {
        startDate: "2026-10-30",
        endDate: "2026-10-30",
        allDay: false,
        startTime: "14:00",
        endTime: "10:00",
        reason: "Backwards window",
      }),
    ).toMatchObject({ ok: false, kind: "validation" });
  });

  it("labels closures in plain words", async () => {
    expect(blackoutLabel("2026-11-02T00:00:00.000Z", "2026-11-03T00:00:00.000Z")).toBe(
      "Mon, 2 Nov 2026 · all day",
    );
    expect(blackoutLabel("2026-11-02T00:00:00.000Z", "2026-11-05T00:00:00.000Z")).toBe(
      "Mon, 2 Nov 2026 – Wed, 4 Nov 2026 · all day",
    );
    expect(blackoutLabel("2026-11-02T08:00:00.000Z", "2026-11-02T18:00:00.000Z")).toBe(
      "Mon, 2 Nov 2026 · 08:00–18:00",
    );
  });

  it("keeps administrator edits when setup reseeds the database", async () => {
    await updateRoomDetails(testDatabase.db, admin, "room_seminar_02", {
      ...seminarDetails,
      name: "Seminar Room 02 (Renovated)",
      managerId: "usr_priya_nair",
    });
    await updateRoomHours(testDatabase.db, admin, "room_seminar_02", weekdays("07:00", "23:00"));
    await updateRoomPolicy(testDatabase.db, admin, "room_seminar_02", {
      ...defaultPolicy,
      allocationRule: "best_fit",
    });

    await seedDatabase(testDatabase.db, { now: fixedNow });

    const access = await getAdminRoom(testDatabase.db, admin, "room_seminar_02");
    expect(access?.room).toMatchObject({
      name: "Seminar Room 02 (Renovated)",
      managerId: "usr_priya_nair",
      policy: { allocationRule: "best_fit" },
    });
    expect(access?.room.hours.find((day) => day.weekday === 1)?.opensAt).toBe("07:00");
    expect(
      ((await testDatabase.db
        .prepare("SELECT count(*) AS count FROM availability_rules WHERE room_id = 'room_seminar_02'")
        .get()) as { count: number }).count,
    ).toBe(5);
  });
});
