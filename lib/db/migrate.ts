import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { RoomRelayDatabase } from "@/lib/db/client";

const DEFAULT_MIGRATIONS_DIRECTORY = path.join(process.cwd(), "db", "migrations");

export interface AppliedMigration {
  name: string;
  applied_at: string;
}

export function ensureMigrationsTable(db: RoomRelayDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

export function getAppliedMigrations(
  db: RoomRelayDatabase,
): AppliedMigration[] {
  ensureMigrationsTable(db);

  return db
    .prepare("SELECT name, applied_at FROM schema_migrations ORDER BY name")
    .all() as AppliedMigration[];
}

/**
 * Applies every unapplied SQL file in lexicographic order. Each migration and
 * its bookkeeping row commit together, so a failed migration cannot be marked
 * as applied.
 */
export function runMigrations(
  db: RoomRelayDatabase,
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY,
): string[] {
  ensureMigrationsTable(db);

  const files = readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No migrations found in ${migrationsDirectory}.`);
  }

  const appliedNames = new Set(
    getAppliedMigrations(db).map((migration) => migration.name),
  );
  const insertMigration = db.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
  );
  const appliedNow: string[] = [];

  for (const file of files) {
    if (appliedNames.has(file)) {
      continue;
    }

    const sql = readFileSync(path.join(migrationsDirectory, file), "utf8");
    const apply = db.transaction(() => {
      db.exec(sql);
      insertMigration.run(file, new Date().toISOString());
    });

    apply();
    appliedNow.push(file);
  }

  return appliedNow;
}
