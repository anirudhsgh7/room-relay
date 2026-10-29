import { openDatabase, type RoomRelayDatabase } from "@/lib/db/client";
import { getProfileById, type UserProfile } from "@/lib/auth/service";
import { runMigrations } from "@/lib/db/migrate";
import { seedDatabase, type SeedSummary } from "@/lib/db/seed";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://roomrelay:roomrelay_test@127.0.0.1:55432/roomrelay_test";

const DATA_TABLES = [
  "notifications",
  "room_blackouts",
  "condition_reports",
  "incidents",
  "access_events",
  "audit_events",
  "credentials",
  "bookings",
  "profile_eligibility",
  "room_booking_policies",
  "eligibility_requirements",
  "availability_rules",
  "rooms",
  "profiles",
];

export interface TestDatabase {
  db: RoomRelayDatabase;
  cleanup: () => void;
}

export async function getTestProfile(
  db: RoomRelayDatabase,
  id: string,
): Promise<UserProfile> {
  const profile = await getProfileById(db, id);

  if (!profile) {
    throw new Error(`Missing test profile: ${id}`);
  }

  return profile;
}

async function resetData(db: RoomRelayDatabase): Promise<void> {
  await db.exec(`TRUNCATE TABLE ${DATA_TABLES.join(", ")} CASCADE`);
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const db = openDatabase(TEST_DATABASE_URL);
  await runMigrations(db);
  await resetData(db);

  return {
    db,
    cleanup: () => {
      void db.close();
    },
  };
}

export async function createSeededTestDatabase(
  now = new Date("2026-10-28T12:00:00.000Z"),
): Promise<TestDatabase & { summary: SeedSummary }> {
  const testDatabase = await createTestDatabase();
  const summary = await seedDatabase(testDatabase.db, { now });

  return { ...testDatabase, summary };
}
