import "./load-env";
import { getDatabaseUrl } from "@/lib/config";
import { openDatabase } from "@/lib/db/client";

async function main(): Promise<void> {
  if (process.env.ROOMRELAY_ALLOW_DB_RESET !== "1") {
    throw new Error(
      "Refusing to reset a Postgres database. Set ROOMRELAY_ALLOW_DB_RESET=1 only when you are certain this is a disposable database.",
    );
  }

  const db = openDatabase(getDatabaseUrl());

  try {
    await db.exec("DROP SCHEMA IF EXISTS public CASCADE");
    await db.exec("CREATE SCHEMA public");
    console.log("Database schema reset. Run `npm run db:setup` to recreate it.");
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
