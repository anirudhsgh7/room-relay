import type { RoomRelayDatabase } from "@/lib/db/client";
import {
  createNotification,
  requesterLink,
  reviewerLink,
} from "@/lib/notifications/service";
import {
  formatCampusDate,
  formatCampusDateTime,
  formatCampusTime,
} from "@/lib/time/campus-time";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Reminder windows. Each reminder is delivered at most once (dedupe key). */
export const REMINDER_WINDOWS = {
  dayBeforeMs: 24 * HOUR,
  hourBeforeMs: HOUR,
  checkoutBeforeEndMs: 15 * MINUTE,
  overdueAfterEndMs: 15 * MINUTE,
  decisionNeededBeforeStartMs: 24 * HOUR,
  /** Only look back this far so a long-idle system does not flood inboxes. */
  lookbackMs: 7 * 24 * HOUR,
  /** Skip the day-before reminder when the approval itself was this recent. */
  freshApprovalMs: 2 * HOUR,
} as const;

interface ReminderRow {
  id: string;
  status: string;
  requester_id: string;
  requester_name: string;
  manager_id: string;
  manager_status: string;
  room_name: string;
  start_at: string;
  end_at: string;
  decided_at: string | null;
}

export interface ReminderSweepResult {
  startReminders: number;
  checkoutReminders: number;
  overdueAlerts: number;
  decisionAlerts: number;
  lapsedNotices: number;
}

const ROW_SELECT = `
  SELECT
    b.id, b.status, b.requester_id, b.start_at, b.end_at, b.decided_at,
    requester.display_name AS requester_name,
    r.name AS room_name, r.manager_id,
    manager.status AS manager_status
  FROM bookings b
  JOIN rooms r ON r.id = b.room_id
  JOIN profiles requester ON requester.id = b.requester_id
  JOIN profiles manager ON manager.id = r.manager_id
`;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function dayWord(startAt: string, nowIso: string): string {
  const startDate = formatCampusDate(startAt);
  const today = formatCampusDate(nowIso);
  const tomorrow = formatCampusDate(iso(Date.parse(nowIso) + 24 * HOUR));

  if (startDate === today) {
    return "today";
  }

  if (startDate === tomorrow) {
    return "tomorrow";
  }

  return `on ${startDate}`;
}

/**
 * Delivers every reminder that is due at `now`. Safe to run as often as you
 * like: each reminder has a dedupe key, so re-running never duplicates one.
 */
export function runReminderSweep(
  db: RoomRelayDatabase,
  now = new Date(),
): ReminderSweepResult {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const result: ReminderSweepResult = {
    startReminders: 0,
    checkoutReminders: 0,
    overdueAlerts: 0,
    decisionAlerts: 0,
    lapsedNotices: 0,
  };

  const sweep = db.transaction(() => {
    // 1. Upcoming approved bookings: one reminder the day before, one within
    //    the hour. A late sweep sends only the most relevant one.
    const upcoming = db
      .prepare(
        `${ROW_SELECT}
         WHERE b.status = 'approved'
           AND julianday(b.start_at) > julianday(?)
           AND julianday(b.start_at) <= julianday(?)
         ORDER BY b.start_at`,
      )
      .all(nowIso, iso(nowMs + REMINDER_WINDOWS.dayBeforeMs)) as ReminderRow[];

    for (const booking of upcoming) {
      const startMs = Date.parse(booking.start_at);
      const withinHour = startMs - nowMs <= REMINDER_WINDOWS.hourBeforeMs;
      const slot = formatCampusDateTime(booking.start_at, booking.end_at);

      if (withinHour) {
        const sent = createNotification(db, {
          recipientId: booking.requester_id,
          kind: "reminder_start",
          title: `Starting soon: ${booking.room_name}`,
          body: `Your booking starts at ${formatCampusTime(
            booking.start_at,
          )}. When you arrive, open Check in and tap your card.`,
          linkPath: requesterLink(booking.id),
          bookingId: booking.id,
          dedupeKey: `reminder:hour:${booking.id}`,
          createdAt: nowIso,
        });
        result.startReminders += sent ? 1 : 0;
        continue;
      }

      const approvedRecently =
        booking.decided_at !== null &&
        nowMs - Date.parse(booking.decided_at) < REMINDER_WINDOWS.freshApprovalMs;

      if (approvedRecently) {
        continue;
      }

      const sent = createNotification(db, {
        recipientId: booking.requester_id,
        kind: "reminder_start",
        title: `Coming up ${dayWord(booking.start_at, nowIso)}: ${booking.room_name}`,
        body: `You have ${booking.room_name} booked for ${slot}. If plans change, cancel so someone else can use the room.`,
        linkPath: requesterLink(booking.id),
        bookingId: booking.id,
        dedupeKey: `reminder:day:${booking.id}`,
        createdAt: nowIso,
      });
      result.startReminders += sent ? 1 : 0;
    }

    // 2. Bookings in use: remind before the end, and flag overdue check-outs
    //    to both the requester and the room manager.
    const inUse = db
      .prepare(
        `${ROW_SELECT}
         WHERE b.status = 'checked_in'
           AND julianday(b.end_at) <= julianday(?)
           AND julianday(b.end_at) > julianday(?)
         ORDER BY b.end_at`,
      )
      .all(
        iso(nowMs + REMINDER_WINDOWS.checkoutBeforeEndMs),
        iso(nowMs - REMINDER_WINDOWS.lookbackMs),
      ) as ReminderRow[];

    for (const booking of inUse) {
      const endMs = Date.parse(booking.end_at);
      const endLabel = formatCampusTime(booking.end_at);

      if (nowMs - endMs >= REMINDER_WINDOWS.overdueAfterEndMs) {
        const toRequester = createNotification(db, {
          recipientId: booking.requester_id,
          kind: "checkout_overdue",
          title: `Please check out of ${booking.room_name}`,
          body: `Your booking ended at ${endLabel}. Check out now and leave a short note on the room's condition so the next group knows what to expect.`,
          linkPath: requesterLink(booking.id),
          bookingId: booking.id,
          dedupeKey: `reminder:overdue:${booking.id}`,
          createdAt: nowIso,
        });

        const toManager =
          booking.manager_status === "active"
            ? createNotification(db, {
                recipientId: booking.manager_id,
                kind: "checkout_overdue",
                title: `Not checked out: ${booking.room_name}`,
                body: `${booking.requester_name}'s booking ended at ${endLabel} and has not been checked out.`,
                linkPath: reviewerLink(booking.id),
                bookingId: booking.id,
                dedupeKey: `alert:overdue:${booking.id}`,
                createdAt: nowIso,
              })
            : false;

        result.overdueAlerts += (toRequester ? 1 : 0) + (toManager ? 1 : 0);
        continue;
      }

      const sent = createNotification(db, {
        recipientId: booking.requester_id,
        kind: "reminder_checkout",
        title: `Time to wrap up in ${booking.room_name}`,
        body: `Your booking ends at ${endLabel}. Before you leave, check out and note the room's condition.`,
        linkPath: requesterLink(booking.id),
        bookingId: booking.id,
        dedupeKey: `reminder:checkout:${booking.id}`,
        createdAt: nowIso,
      });
      result.checkoutReminders += sent ? 1 : 0;
    }

    // 3. Requests nobody has decided yet that start within a day.
    const undecided = db
      .prepare(
        `${ROW_SELECT}
         WHERE b.status = 'pending'
           AND julianday(b.start_at) > julianday(?)
           AND julianday(b.start_at) <= julianday(?)
         ORDER BY b.start_at`,
      )
      .all(
        nowIso,
        iso(nowMs + REMINDER_WINDOWS.decisionNeededBeforeStartMs),
      ) as ReminderRow[];

    for (const booking of undecided) {
      if (booking.manager_status !== "active") {
        continue;
      }

      const sent = createNotification(db, {
        recipientId: booking.manager_id,
        kind: "decision_needed",
        title: `Decision needed soon: ${booking.room_name}`,
        body: `${booking.requester_name}'s request for ${formatCampusDateTime(
          booking.start_at,
          booking.end_at,
        )} starts ${dayWord(booking.start_at, nowIso)} and has no decision yet.`,
        linkPath: reviewerLink(booking.id),
        bookingId: booking.id,
        dedupeKey: `alert:decision-soon:${booking.id}`,
        createdAt: nowIso,
      });
      result.decisionAlerts += sent ? 1 : 0;
    }

    // 4. Close the loop on requests whose time passed without an outcome.
    const lapsed = db
      .prepare(
        `${ROW_SELECT}
         WHERE b.status IN ('pending', 'waitlisted')
           AND julianday(b.start_at) <= julianday(?)
           AND julianday(b.start_at) > julianday(?)`,
      )
      .all(nowIso, iso(nowMs - REMINDER_WINDOWS.lookbackMs)) as ReminderRow[];

    for (const booking of lapsed) {
      const waitlisted = booking.status === "waitlisted";
      const sent = createNotification(db, {
        recipientId: booking.requester_id,
        kind: waitlisted ? "waitlist_lapsed" : "request_lapsed",
        title: waitlisted
          ? `Waitlist closed: ${booking.room_name}`
          : `No decision in time: ${booking.room_name}`,
        body: waitlisted
          ? `The time you waitlisted for (${formatCampusDateTime(
              booking.start_at,
              booking.end_at,
            )}) did not free up before it started, so your waitlist place has closed.`
          : `Your request for ${formatCampusDateTime(
              booking.start_at,
              booking.end_at,
            )} was not reviewed before it started. It is not an approved booking. Submit a new request for another time.`,
        linkPath: requesterLink(booking.id),
        bookingId: booking.id,
        dedupeKey: `notice:lapsed:${booking.id}`,
        createdAt: nowIso,
      });
      result.lapsedNotices += sent ? 1 : 0;
    }
  });

  sweep.immediate();
  return result;
}

const globalForSweep = globalThis as typeof globalThis & {
  __roomRelayLastReminderSweep?: number;
};

/**
 * Runs the sweep at most once a minute per server process. Called on workspace
 * page loads so reminders work without a separate scheduler; `npm run
 * reminders` (for cron) runs the same sweep on demand.
 */
export function maybeRunReminderSweep(
  db: RoomRelayDatabase,
  now = new Date(),
  minimumIntervalMs = MINUTE,
): ReminderSweepResult | null {
  const last = globalForSweep.__roomRelayLastReminderSweep ?? 0;

  if (now.getTime() - last < minimumIntervalMs) {
    return null;
  }

  globalForSweep.__roomRelayLastReminderSweep = now.getTime();

  try {
    return runReminderSweep(db, now);
  } catch (error) {
    console.error(
      "Reminder sweep failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return null;
  }
}

export function resetReminderThrottleForTests(): void {
  delete globalForSweep.__roomRelayLastReminderSweep;
}
