import "./load-env";
import { getDatabaseUrl } from "@/lib/config";
import { openDatabase } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

async function main(): Promise<void> {
  const db = openDatabase(getDatabaseUrl());

  try {
    const applied = await runMigrations(db);
    console.log("Database: Postgres");
    console.log(
      applied.length > 0
        ? `Applied migrations: ${applied.join(", ")}`
        : "Migrations already up to date.",
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
