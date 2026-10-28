import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getProfileById } from "@/lib/auth/service";
import { getRoomDetail, searchRooms, getRoomFilterOptions } from "@/lib/rooms/queries";
import { parseRoomSearchParams } from "@/lib/rooms/search";
import { parseCampusInterval } from "@/lib/time/campus-time";
import { createSeededTestDatabase } from "./helpers";

type SeededTestDatabase = Awaited<ReturnType<typeof createSeededTestDatabase>>;

function interval(date: string, start: string, end: string) {
  const result = parseCampusInterval(date, start, end, "Europe/London");
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.interval;
}

describe("room discovery queries", () => {
  let testDatabase: SeededTestDatabase;
  let student: NonNullable<ReturnType<typeof getProfileById>>;

  beforeEach(async () => {
    testDatabase = await createSeededTestDatabase();
    student = getProfileById(testDatabase.db, "usr_amelia_chen")!;
  });

  afterEach(() => {
    testDatabase.cleanup();
  });

  it("returns active rooms and filter options only", () => {
    const rooms = searchRooms(
      testDatabase.db,
      student,
      { minCapacity: null, building: null, facilities: [] },
      null,
    );
    const options = getRoomFilterOptions(testDatabase.db);

    expect(rooms.map((room) => room.code).sort()).toEqual([
      "LIB-03",
      "MED-01",
      "NEW-14",
      "SEM-02",
    ]);
    expect(options.buildings).toEqual([
      "Arts Annex",
      "Central Library",
      "Hazelwood Hall",
      "Newton Building",
    ]);
    expect(options.facilities).toEqual(
      expect.arrayContaining(["Projector", "Whiteboard", "Hearing loop"]),
    );
  });

  it("applies capacity, building, and AND-style facility filters", () => {
    const capacityRooms = searchRooms(
      testDatabase.db,
      student,
      { minCapacity: 20, building: null, facilities: [] },
      null,
    );
    const buildingRooms = searchRooms(
      testDatabase.db,
      student,
      { minCapacity: null, building: "Arts Annex", facilities: [] },
      null,
    );
    const facilityRooms = searchRooms(
      testDatabase.db,
      student,
      {
        minCapacity: null,
        building: null,
        facilities: ["Projector", "Whiteboard"],
      },
      null,
    );

    expect(capacityRooms.map((room) => room.code)).toEqual(["NEW-14"]);
    expect(buildingRooms.map((room) => room.code)).toEqual(["MED-01"]);
    expect(facilityRooms.map((room) => room.code)).toEqual(["SEM-02"]);
  });

  it("marks a confirmed booking as a conflict without leaking its details", () => {
    const approved = testDatabase.db
      .prepare(
        "SELECT start_at, end_at FROM bookings WHERE id = 'booking_approved_seminar'",
      )
      .get() as { start_at: string; end_at: string };
    const approvedInterval = interval(
      "2026-10-29",
      "16:00",
      "17:30",
    );

    expect(Date.parse(approved.start_at)).toBe(
      Date.parse(approvedInterval.startUtc),
    );

    const rooms = searchRooms(
      testDatabase.db,
      student,
      { minCapacity: null, building: null, facilities: [] },
      approvedInterval,
    );
    const seminar = rooms.find((room) => room.code === "SEM-02");

    expect(seminar?.availability).toBe("conflict");
    expect(JSON.stringify(seminar)).not.toContain("Robotics");
    expect(JSON.stringify(seminar)).not.toContain("booking_approved_seminar");
  });

  it("applies a room's turnaround buffer after a confirmed booking", () => {
    testDatabase.db
      .prepare(
        "UPDATE room_booking_policies SET buffer_minutes = 15 WHERE room_id = 'room_seminar_02'",
      )
      .run();

    const closeToEnd = searchRooms(
      testDatabase.db,
      student,
      { minCapacity: null, building: "Hazelwood Hall", facilities: [] },
      interval("2026-10-29", "17:30", "18:30"),
    );
    const afterBuffer = searchRooms(
      testDatabase.db,
      student,
      { minCapacity: null, building: "Hazelwood Hall", facilities: [] },
      interval("2026-10-29", "18:00", "18:30"),
    );

    expect(closeToEnd[0]?.availability).toBe("conflict");
    expect(afterBuffer[0]?.availability).toBe("available");
  });

  it("marks intervals that violate the room's time policy", () => {
    const rooms = searchRooms(
      testDatabase.db,
      student,
      { minCapacity: null, building: "Hazelwood Hall", facilities: [] },
      interval("2026-10-29", "10:15", "11:15"),
    );

    expect(rooms[0]?.availability).toBe("invalid_time");
  });

  it("marks rooms as outside hours for an out-of-schedule interval", () => {
    const rooms = searchRooms(
      testDatabase.db,
      student,
      { minCapacity: null, building: null, facilities: [] },
      interval("2026-10-29", "23:00", "23:30"),
    );

    expect(rooms.every((room) => room.availability === "outside_hours")).toBe(true);
  });

  it("shows room requirements and the student's verification state", () => {
    const seminar = getRoomDetail(testDatabase.db, student, "SEM-02", null);
    const media = getRoomDetail(testDatabase.db, student, "MED-01", null);

    expect(seminar?.requirements[0]?.verification).toBe("verified");
    expect(seminar?.hasUnverifiedRequiredRequirement).toBe(false);
    expect(media?.requirements[0]?.verification).toBe("unverified");
    expect(media?.hasUnverifiedRequiredRequirement).toBe(true);
  });

  it("does not expose student verification state to a manager", () => {
    const manager = getProfileById(testDatabase.db, "usr_marcus_webb")!;
    const media = getRoomDetail(testDatabase.db, manager, "MED-01", null);

    expect(media?.requirements[0]?.verification).toBeNull();
    expect(media?.hasUnverifiedRequiredRequirement).toBe(false);
  });

  it("does not return inactive rooms through a guessed code", () => {
    expect(getRoomDetail(testDatabase.db, student, "ARC-B1", null)).toBeNull();
  });

  it("labels active rooms with requests disabled as not requestable", () => {
    testDatabase.db
      .prepare(
        "UPDATE room_booking_policies SET requests_enabled = 0 WHERE room_id = 'room_library_quiet'",
      )
      .run();

    const rooms = searchRooms(
      testDatabase.db,
      student,
      { minCapacity: null, building: "Central Library", facilities: [] },
      null,
    );

    expect(rooms[0]?.availability).toBe("not_requestable");
  });

  it("validates and parses allowlisted discovery query parameters", () => {
    const parsed = parseRoomSearchParams({
      date: "2026-10-29",
      start: "10:00",
      end: "11:30",
      capacity: "12",
      building: "Hazelwood Hall",
      facility: ["Projector", "Whiteboard"],
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.interval?.startUtc).toBe("2026-10-29T10:00:00Z");
      expect(parsed.values.facilities).toEqual(["Projector", "Whiteboard"]);
      expect(parsed.hasFilters).toBe(true);
    }

    const invalidCapacity = parseRoomSearchParams({ capacity: "many" });
    const partialTime = parseRoomSearchParams({
      date: "2026-10-29",
      start: "10:00",
    });
    const dateOnly = parseRoomSearchParams({ date: "2026-10-29" });

    expect(invalidCapacity.ok).toBe(false);
    expect(partialTime.ok).toBe(false);
    expect(dateOnly.ok && dateOnly.interval === null).toBe(true);
  });
});
