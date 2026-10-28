import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authenticateWithPassword, getProfileById } from "@/lib/auth/service";
import { createSeededTestDatabase } from "./helpers";

type SeededTestDatabase = Awaited<ReturnType<typeof createSeededTestDatabase>>;

describe("authentication", () => {
  let testDatabase: SeededTestDatabase;

  beforeEach(async () => {
    testDatabase = await createSeededTestDatabase();
  });

  afterEach(() => {
    testDatabase.cleanup();
  });

  it("signs in an active seeded student with correct credentials", async () => {
    const profile = await authenticateWithPassword(
      testDatabase.db,
      "student@roomrelay.demo",
      "demo-student-2026",
    );

    expect(profile).toMatchObject({
      id: "usr_amelia_chen",
      email: "student@roomrelay.demo",
      displayName: "Amelia Chen",
      role: "student",
      status: "active",
    });
  });

  it("treats email lookup as case-insensitive and trims whitespace", async () => {
    const profile = await authenticateWithPassword(
      testDatabase.db,
      "  STUDENT@ROOMRELAY.DEMO  ",
      "demo-student-2026",
    );

    expect(profile?.id).toBe("usr_amelia_chen");
  });

  it("returns null for a wrong password", async () => {
    await expect(
      authenticateWithPassword(
        testDatabase.db,
        "student@roomrelay.demo",
        "wrong-password",
      ),
    ).resolves.toBeNull();
  });

  it("returns null for an unknown account without disclosing whether it exists", async () => {
    await expect(
      authenticateWithPassword(
        testDatabase.db,
        "nobody@roomrelay.demo",
        "demo-student-2026",
      ),
    ).resolves.toBeNull();
  });

  it("refuses a suspended account even with the correct password", async () => {
    await expect(
      authenticateWithPassword(
        testDatabase.db,
        "inactive@roomrelay.demo",
        "demo-inactive-2026",
      ),
    ).resolves.toBeNull();
  });

  it("does not resolve a suspended profile by ID", () => {
    expect(getProfileById(testDatabase.db, "usr_jamie_cole")).toBeNull();
  });

  it("resolves an active profile by ID", () => {
    expect(getProfileById(testDatabase.db, "usr_marcus_webb")).toMatchObject({
      role: "manager",
      status: "active",
    });
  });
});
