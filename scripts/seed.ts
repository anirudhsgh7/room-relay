import "./load-env";
import { getDatabaseUrl } from "@/lib/config";
import { openDatabase } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { seedDatabase } from "@/lib/db/seed";

async function main() {
  const db = openDatabase(getDatabaseUrl());

  try {
    await runMigrations(db);
    const summary = await seedDatabase(db);
    console.log("Database: Postgres");
    console.table(summary);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
