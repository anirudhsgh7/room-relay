import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type RoomRelayDatabase } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { seedDatabase, type SeedSummary } from "@/lib/db/seed";

export interface TestDatabase {
  db: RoomRelayDatabase;
  directory: string;
  databasePath: string;
  cleanup: () => void;
}

export function createTestDatabase(): TestDatabase {
  const directory = mkdtempSync(path.join(os.tmpdir(), "roomrelay-test-"));
  const databasePath = path.join(directory, "roomrelay.db");
  const db = openDatabase(databasePath);
  runMigrations(db);

  return {
    db,
    directory,
    databasePath,
    cleanup: () => {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export async function createSeededTestDatabase(
  now = new Date("2026-10-28T12:00:00.000Z"),
): Promise<TestDatabase & { summary: SeedSummary }> {
  const testDatabase = createTestDatabase();
  const summary = await seedDatabase(testDatabase.db, { now });

  return { ...testDatabase, summary };
}
