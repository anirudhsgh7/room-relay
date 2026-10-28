import "./load-env";
import { getDatabasePath } from "@/lib/config";
import { openDatabase } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { seedDatabase } from "@/lib/db/seed";

async function main() {
  const databasePath = getDatabasePath();
  const db = openDatabase(databasePath);

  try {
    runMigrations(db);
    const summary = await seedDatabase(db);
    console.log(`Database: ${databasePath}`);
    console.table(summary);
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
