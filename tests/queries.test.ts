import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFoundationSnapshot } from "@/lib/db/queries";
import { createSeededTestDatabase, getTestProfile } from "./helpers";

type SeededTestDatabase = Awaited<ReturnType<typeof createSeededTestDatabase>>;

describe("role-scoped foundation queries", () => {
  let testDatabase: SeededTestDatabase;

  beforeEach(async () => {
    testDatabase = await createSeededTestDatabase();
  });

  afterEach(() => {
    testDatabase.cleanup();
  });

  it("shows a student only their own counts and no institution-wide data", async () => {
    const student = await getTestProfile(testDatabase.db, "usr_amelia_chen");
    expect(student).not.toBeNull();

    const snapshot = await getFoundationSnapshot(testDatabase.db, student!);

    expect(snapshot).toMatchObject({
      activeRooms: 4,
      totalRooms: 5,
      migrationsApplied: 1,
      assignedRooms: [],
      managedPendingBookings: null,
      ownActiveBookings: 4,
      ownActiveCredentials: 1,
      institutionProfiles: null,
      institutionActiveProfiles: null,
      institutionCredentials: null,
      institutionPendingBookings: null,
    });
  });

  it("shows each manager only their assigned active rooms", async () => {
    const marcus = await getTestProfile(testDatabase.db, "usr_marcus_webb");
    const priya = await getTestProfile(testDatabase.db, "usr_priya_nair");

    const marcusSnapshot = await getFoundationSnapshot(testDatabase.db, marcus!);
    const priyaSnapshot = await getFoundationSnapshot(testDatabase.db, priya!);

    expect(marcusSnapshot.assignedRooms).toEqual([
      { code: "NEW-14", name: "Classroom 14" },
      { code: "SEM-02", name: "Seminar Room 02" },
    ]);
    expect(marcusSnapshot.managedPendingBookings).toBe(1);

    expect(priyaSnapshot.assignedRooms).toEqual([
      { code: "LIB-03", name: "Quiet Study 03" },
      { code: "MED-01", name: "Media Studio 01" },
    ]);
    expect(priyaSnapshot.managedPendingBookings).toBe(2);

    expect(marcusSnapshot.institutionProfiles).toBeNull();
    expect(priyaSnapshot.institutionProfiles).toBeNull();
  });

  it("gives an admin institution-wide aggregate visibility", async () => {
    const admin = await getTestProfile(testDatabase.db, "usr_rowan_ellis");
    const snapshot = await getFoundationSnapshot(testDatabase.db, admin!);

    expect(snapshot).toMatchObject({
      activeRooms: 4,
      totalRooms: 5,
      assignedRooms: [],
      institutionProfiles: 6,
      institutionActiveProfiles: 5,
      institutionCredentials: 6,
      institutionPendingBookings: 3,
    });
  });
});
