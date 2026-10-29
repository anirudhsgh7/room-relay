import { NextResponse } from "next/server";
import { getSessionSecret } from "@/lib/config";
import { getDatabase } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checkedAt = new Date().toISOString();

  try {
    const db = getDatabase();
    await db.prepare("SELECT 1").get();
    const migrationRow = (await db
      .prepare("SELECT count(*) AS count FROM schema_migrations")
      .get()) as { count: number };
    getSessionSecret();

    return NextResponse.json(
      {
        status: "ok",
        service: "roomrelay",
        phase: 6,
        database: "ok",
        migrations: migrationRow.count,
        checkedAt,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    console.error("RoomRelay health check failed:", error);
    const reason =
      error instanceof Error && error.message.includes("not initialized")
        ? "database_not_initialized"
        : "configuration_or_database_unavailable";

    return NextResponse.json(
      {
        status: "degraded",
        service: "roomrelay",
        phase: 6,
        database: "unavailable",
        reason,
        checkedAt,
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }
}
