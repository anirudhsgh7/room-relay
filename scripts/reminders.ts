import "./load-env";
import { getDatabaseUrl } from "@/lib/config";
import { openDatabase } from "@/lib/db/client";
import { runReminderSweep } from "@/lib/notifications/reminders";

// Delivers due reminders once. Schedule it (for example every 5 minutes with a
// cron) when the app should send reminders even while nobody is signed in.
const db = openDatabase(getDatabaseUrl());

try {
  const result = await runReminderSweep(db);
  console.log(
    `Reminders delivered: ${result.startReminders} start, ${result.checkoutReminders} check-out, ${result.overdueAlerts} overdue, ${result.decisionAlerts} decision, ${result.lapsedNotices} lapsed.`,
  );
} finally {
  await db.close();
}
