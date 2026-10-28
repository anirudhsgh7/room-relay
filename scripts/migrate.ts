import "./load-env";
import { getDatabasePath } from "@/lib/config";
import { openDatabase } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const databasePath = getDatabasePath();
const db = openDatabase(databasePath);

try {
  const applied = runMigrations(db);
  console.log(`Database: ${databasePath}`);
  console.log(
    applied.length > 0
      ? `Applied migrations: ${applied.join(", ")}`
      : "Migrations already up to date.",
  );
} finally {
  db.close();
}
