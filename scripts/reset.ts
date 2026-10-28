import { existsSync, unlinkSync } from "node:fs";
import "./load-env";
import { getDatabasePath } from "@/lib/config";

if (
  process.env.NODE_ENV === "production" &&
  process.env.ROOMRELAY_ALLOW_DB_RESET !== "1"
) {
  throw new Error(
    "Refusing to reset a production database. Set ROOMRELAY_ALLOW_DB_RESET=1 only if you are certain.",
  );
}

const databasePath = getDatabasePath();

if (databasePath === ":memory:" || databasePath.includes("://")) {
  throw new Error(
    `The configured database path cannot be reset by this script: ${databasePath}`,
  );
}

for (const candidate of [
  databasePath,
  `${databasePath}-shm`,
  `${databasePath}-wal`,
]) {
  if (existsSync(candidate)) {
    unlinkSync(candidate);
    console.log(`Removed ${candidate}`);
  }
}

console.log("Database reset complete. Run `npm run db:setup` to recreate it.");
