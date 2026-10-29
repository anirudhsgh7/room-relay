import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { simulateAccessCheck } from "@/lib/access/service";
import { getProfileById } from "@/lib/auth/service";
import {
  maybeRunReminderSweep,
  resetReminderThrottleForTests,
  runReminderSweep,
} from "@/lib/notifications/reminders";
import {
  countUnreadNotifications,
  createNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications/service";
import { clearRateLimitsForTests } from "@/lib/rate-limit";
import { createSeededTestDatabase } from "./helpers";

type SeededTestDatabase = Awaited<ReturnType<typeof createSeededTestDatabase>>;
type Profile = NonNullable<ReturnType<typeof getProfileById>>;

const fixedNow = new Date("2026-10-28T12:00:00.000Z");

function kinds(testDatabase: SeededTestDatabase, recipientId: string): string[] {
  return (
    testDatabase.db
      .prepare(
        "SELECT kind FROM notifications WHERE recipient_id = ? ORDER BY created_at, rowid",
      )
      .all(recipientId) as Array<{ kind: string }>
  ).map((row) => row.kind);
}

function total(testDatabase: SeededTestDatabase): number {
  return (
    testDatabase.db.prepare("SELECT count(*) AS count FROM notifications").get() as {
      count: number;
    }
  ).count;
}

describe("notification inbox", () => {
  let testDatabase: SeededTestDatabase;
  let amelia: Profile;
  let noah: Profile;

  beforeEach(async () => {
    testDatabase = await createSeededTestDatabase(fixedNow);
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    amelia = getProfileById(testDatabase.db, "usr_amelia_chen")!;
    noah = getProfileById(testDatabase.db, "usr_noah_williams")!;
  });

  afterEach(() => {
    vi.useRealTimers();
    testDatabase.cleanup();
  });

  it("delivers a deduplicated notification only once", () => {
    const input = {
      recipientId: amelia.id,
      kind: "reminder_start" as const,
      title: "Starting soon",
      body: "Your booking starts soon.",
      dedupeKey: "reminder:test",
    };

    expect(createNotification(testDatabase.db, input)).toBe(true);
    expect(createNotification(testDatabase.db, input)).toBe(false);
    expect(countUnreadNotifications(testDatabase.db, amelia.id)).toBe(1);
  });

  it("drops links that leave the workspace", () => {
    createNotification(testDatabase.db, {
      recipientId: amelia.id,
      kind: "booking_cancelled",
      title: "Link test",
      body: "This link should be dropped.",
      linkPath: "https://example.com/phish",
    });

    expect(listNotifications(testDatabase.db, amelia)[0]?.linkPath).toBeNull();
  });

  it("only lets a person read and clear their own notifications", () => {
    createNotification(testDatabase.db, {
      recipientId: amelia.id,
      kind: "decision_approved",
      title: "Approved",
      body: "Your booking is confirmed.",
    });
    const [item] = listNotifications(testDatabase.db, amelia);

    expect(listNotifications(testDatabase.db, noah)).toHaveLength(0);
    expect(markNotificationRead(testDatabase.db, noah, item!.id)).toBe(false);
    expect(countUnreadNotifications(testDatabase.db, amelia.id)).toBe(1);

    expect(markNotificationRead(testDatabase.db, amelia, item!.id)).toBe(true);
    expect(countUnreadNotifications(testDatabase.db, amelia.id)).toBe(0);

    createNotification(testDatabase.db, {
      recipientId: amelia.id,
      kind: "decision_approved",
      title: "Approved again",
      body: "Another booking is confirmed.",
    });
    expect(markAllNotificationsRead(testDatabase.db, amelia)).toBe(1);
    expect(countUnreadNotifications(testDatabase.db, amelia.id)).toBe(0);
  });
});

describe("reminder sweep", () => {
  let testDatabase: SeededTestDatabase;
  let amelia: Profile;

  beforeEach(async () => {
    testDatabase = await createSeededTestDatabase(fixedNow);
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    clearRateLimitsForTests();
    resetReminderThrottleForTests();
    amelia = getProfileById(testDatabase.db, "usr_amelia_chen")!;
  });

  afterEach(() => {
    clearRateLimitsForTests();
    resetReminderThrottleForTests();
    vi.useRealTimers();
    testDatabase.cleanup();
  });

  it("sends one day-before and one within-the-hour reminder, never duplicates", () => {
    // Seeded approved Seminar Room booking: Thu 29 Oct 16:00–17:30 UTC.
    runReminderSweep(testDatabase.db, new Date("2026-10-28T12:00:00.000Z"));
    expect(kinds(testDatabase, amelia.id)).not.toContain("reminder_start");

    const morning = new Date("2026-10-29T09:00:00.000Z");
    runReminderSweep(testDatabase.db, morning);
    runReminderSweep(testDatabase.db, morning);

    const dayReminders = testDatabase.db
      .prepare(
        "SELECT title FROM notifications WHERE recipient_id = ? AND kind = 'reminder_start'",
      )
      .all(amelia.id) as Array<{ title: string }>;
    expect(dayReminders).toEqual([{ title: "Coming up today: Seminar Room 02" }]);

    runReminderSweep(testDatabase.db, new Date("2026-10-29T15:30:00.000Z"));
    runReminderSweep(testDatabase.db, new Date("2026-10-29T15:45:00.000Z"));

    const titles = (
      testDatabase.db
        .prepare(
          "SELECT title FROM notifications WHERE recipient_id = ? AND kind = 'reminder_start' ORDER BY created_at",
        )
        .all(amelia.id) as Array<{ title: string }>
    ).map((row) => row.title);
    expect(titles).toEqual([
      "Coming up today: Seminar Room 02",
      "Starting soon: Seminar Room 02",
    ]);
  });

  it("skips the day-before reminder when the approval itself just arrived", () => {
    testDatabase.db
      .prepare("UPDATE bookings SET decided_at = ? WHERE id = 'booking_approved_seminar'")
      .run("2026-10-29T08:30:00.000Z");

    const result = runReminderSweep(testDatabase.db, new Date("2026-10-29T09:00:00.000Z"));

    expect(result.startReminders).toBe(0);
  });

  it("reminds before the end of a booking in use and flags overdue check-outs", () => {
    const access = simulateAccessCheck(testDatabase.db, amelia, {
      credentialId: "cred_amelia_active",
      roomId: "room_classroom_14",
      eventNonce: randomUUID(),
    });
    expect(access.ok).toBe(true);

    // The demo classroom booking ends 45 minutes after the seed time.
    const end = Date.parse("2026-10-28T12:45:00.000Z");

    runReminderSweep(testDatabase.db, new Date(end - 10 * 60_000));
    expect(kinds(testDatabase, amelia.id)).toContain("reminder_checkout");

    runReminderSweep(testDatabase.db, new Date(end + 20 * 60_000));
    runReminderSweep(testDatabase.db, new Date(end + 40 * 60_000));

    expect(kinds(testDatabase, amelia.id).filter((kind) => kind === "checkout_overdue")).toHaveLength(1);
    expect(kinds(testDatabase, "usr_marcus_webb")).toEqual(["checkout_overdue"]);
  });

  it("warns the manager about undecided requests that start within a day", () => {
    // Seeded pending Media Studio requests: Fri 30 Oct 15:00 UTC.
    runReminderSweep(testDatabase.db, new Date("2026-10-29T16:00:00.000Z"));
    runReminderSweep(testDatabase.db, new Date("2026-10-29T18:00:00.000Z"));

    expect(kinds(testDatabase, "usr_priya_nair")).toEqual([
      "decision_needed",
      "decision_needed",
    ]);
  });

  it("closes the loop when a request's time passes without a decision", () => {
    runReminderSweep(testDatabase.db, new Date("2026-10-30T15:30:00.000Z"));

    expect(kinds(testDatabase, amelia.id)).toContain("request_lapsed");
    expect(kinds(testDatabase, "usr_noah_williams")).toContain("request_lapsed");
  });

  it("throttles page-load sweeps to once a minute per process", () => {
    const first = maybeRunReminderSweep(testDatabase.db, fixedNow);
    const second = maybeRunReminderSweep(
      testDatabase.db,
      new Date(fixedNow.getTime() + 30_000),
    );
    const third = maybeRunReminderSweep(
      testDatabase.db,
      new Date(fixedNow.getTime() + 61_000),
    );

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(third).not.toBeNull();
    expect(total(testDatabase)).toBeGreaterThanOrEqual(0);
  });
});
