import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { RoomRelayDatabase } from "@/lib/db/client";

const DEFAULT_MIGRATIONS_DIRECTORY = path.join(
  process.cwd(),
  "db",
  "postgres",
);

export interface AppliedMigration {
  name: string;
  applied_at: string;
}

export async function ensureMigrationsTable(
  db: RoomRelayDatabase,
): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL
    );
  `);
}

export async function getAppliedMigrations(
  db: RoomRelayDatabase,
): Promise<AppliedMigration[]> {
  await ensureMigrationsTable(db);

  return db
    .prepare("SELECT name, applied_at::text AS applied_at FROM schema_migrations ORDER BY name")
    .all<AppliedMigration>();
}

/**
 * Applies every unapplied SQL file in lexicographic order. Each migration and
 * its bookkeeping row commit together. A transaction-scoped advisory lock
 * prevents two deploys from racing the same schema change.
 */
export async function runMigrations(
  db: RoomRelayDatabase,
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY,
): Promise<string[]> {
  await ensureMigrationsTable(db);

  const files = readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No migrations found in ${migrationsDirectory}.`);
  }

  const appliedNames = new Set(
    (await getAppliedMigrations(db)).map((migration) => migration.name),
  );
  const appliedNow: string[] = [];

  for (const file of files) {
    if (appliedNames.has(file)) {
      continue;
    }

    const sql = readFileSync(path.join(migrationsDirectory, file), "utf8");
    const apply = db.transaction(async () => {
      await db.exec("SELECT pg_advisory_xact_lock(hashtext('roomrelay_migrations'))");
      await db.exec(sql);
      await db
        .prepare(
          "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
        )
        .run([file, new Date().toISOString()]);
    });

    await apply.immediate();
    appliedNow.push(file);
  }

  return appliedNow;
}
