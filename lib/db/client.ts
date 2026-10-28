import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getDatabasePath } from "@/lib/config";

export type RoomRelayDatabase = Database.Database;

export function openDatabase(databasePath: string): RoomRelayDatabase {
  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");

  if (databasePath !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }

  return db;
}

const globalForDatabase = globalThis as typeof globalThis & {
  __roomRelayDatabase?: RoomRelayDatabase;
};

export function getDatabase(): RoomRelayDatabase {
  if (globalForDatabase.__roomRelayDatabase) {
    return globalForDatabase.__roomRelayDatabase;
  }

  const db = openDatabase(getDatabasePath());

  const schema = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'profiles'",
    )
    .get();

  if (!schema) {
    db.close();
    throw new Error(
      "The RoomRelay database is not initialized. Run `npm run db:setup` before starting the app.",
    );
  }

  globalForDatabase.__roomRelayDatabase = db;
  return db;
}

export function closeDatabase(): void {
  globalForDatabase.__roomRelayDatabase?.close();
  delete globalForDatabase.__roomRelayDatabase;
}
