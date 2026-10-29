import type { UserProfile } from "@/lib/auth/service";
import { listMyBookings, type MyBooking } from "@/lib/bookings/queries";
import { getWaitlistStanding } from "@/lib/bookings/waitlist";
import type { RoomRelayDatabase } from "@/lib/db/client";
import type { BookingStatus } from "@/lib/domain";
import {
  campusLocalDayRange,
  campusToday,
  formatCampusDateTime,
  formatCampusTime,
} from "@/lib/time/campus-time";

export type HomeTone = "good" | "attention" | "problem" | "neutral";

export interface HomeAction {
  title: string;
  detail: string;
  href: string;
  cta: string;
  tone: HomeTone;
}

export interface HomeBooking {
  id: string;
  roomName: string;
  when: string;
  status: BookingStatus;
  note: string | null;
  href: string;
}

export interface StudentHome {
  actions: HomeAction[];
  upcoming: HomeBooking[];
  upcomingTotal: number;
}

export interface StaffStat {
  label: string;
  value: number;
  href: string;
  tone: HomeTone;
}

export interface StaffHome {
  actions: HomeAction[];
  stats: StaffStat[];
  decideSoon: Array<HomeBooking & { requesterName: string; competing: number }>;
  today: Array<HomeBooking & { requesterName: string }>;
  roomsNeedingSetup: Array<{ id: string; name: string; problem: string }>;
}

const DAY = 24 * 60 * 60 * 1000;

export async function getStudentHome(
  db: RoomRelayDatabase,
  profile: UserProfile,
): Promise<StudentHome> {
  const nowMs = Date.now();
  const all = await listMyBookings(db, profile, 100);
  const actions: HomeAction[] = [];

  for (const booking of all) {
    const start = Date.parse(booking.startAt);
    const end = Date.parse(booking.endAt);

    if (booking.status === "checked_in") {
      actions.push({
        title: end < nowMs ? `Check out of ${booking.roomName}` : `You're in ${booking.roomName}`,
        detail:
          end < nowMs
            ? `Your booking ended at ${formatCampusTime(booking.endAt)}. Check out and note the room's condition.`
            : `Until ${formatCampusTime(booking.endAt)}. Check out when you leave.`,
        href: `/app/bookings/${booking.id}#check-out`,
        cta: "Check out",
        tone: end < nowMs ? "problem" : "attention",
      });
    } else if (booking.status === "approved" && start <= nowMs && end > nowMs) {
      actions.push({
        title: `Your ${booking.roomName} booking has started`,
        detail: `It runs until ${formatCampusTime(booking.endAt)}. Tap your card when you arrive.`,
        href: "/app/access",
        cta: "Check in",
        tone: "attention",
      });
    } else if (booking.status === "approved" && start > nowMs && start - nowMs <= DAY) {
      actions.push({
        title: `${booking.roomName} is coming up`,
        detail: `${formatCampusDateTime(booking.startAt, booking.endAt)}. Cancel if you no longer need it so someone else can.`,
        href: `/app/bookings/${booking.id}`,
        cta: "View booking",
        tone: "neutral",
      });
    }
  }

  const upcoming = all
    .filter(
      (booking) =>
        ["pending", "waitlisted", "approved", "checked_in"].includes(booking.status) &&
        Date.parse(booking.endAt) > nowMs,
    )
    .sort((left, right) => left.startAt.localeCompare(right.startAt));

  return {
    actions,
    upcomingTotal: upcoming.length,
    upcoming: await Promise.all(
      upcoming.slice(0, 5).map((booking) => toHomeBooking(db, booking)),
    ),
  };
}

async function toHomeBooking(
  db: RoomRelayDatabase,
  booking: MyBooking,
): Promise<HomeBooking> {
  let note: string | null = null;

  if (booking.status === "waitlisted") {
    const standing = await getWaitlistStanding(db, booking.id);
    note = standing ? `Number ${standing.position} on the waitlist` : "On the waitlist";
  } else if (booking.status === "pending") {
    note = "Waiting for the room manager";
  }

  return {
    id: booking.id,
    roomName: booking.roomName,
    when: formatCampusDateTime(booking.startAt, booking.endAt),
    status: booking.status,
    note,
    href: `/app/bookings/${booking.id}`,
  };
}

export async function getStaffHome(
  db: RoomRelayDatabase,
  profile: UserProfile,
): Promise<StaffHome> {
  const scope = profile.role === "admin" ? "1 = 1" : "r.manager_id = ?";
  const parameters = profile.role === "admin" ? [] : [profile.id];
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const count = async (sql: string, ...extra: unknown[]) =>
    ((await db.prepare(sql).get([...parameters, ...extra])) as { count: number }).count;

  const pendingRows = (await db
    .prepare(
      `SELECT b.id, b.room_id, b.start_at, b.end_at, b.status,
         r.name AS room_name, p.display_name AS requester_name, policy.buffer_minutes
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       JOIN profiles p ON p.id = b.requester_id
       LEFT JOIN room_booking_policies policy ON policy.room_id = r.id
       WHERE ${scope}
         AND b.status = 'pending'
         AND b.start_at > ?
       ORDER BY b.start_at
       LIMIT 5`,
    )
    .all([...parameters, nowIso])) as Array<{
    id: string;
    room_id: string;
    start_at: string;
    end_at: string;
    status: BookingStatus;
    room_name: string;
    requester_name: string;
    buffer_minutes: number | null;
  }>;

  const competing = db.prepare(
    `SELECT count(*) AS count
     FROM bookings other
     WHERE other.room_id = @room_id
       AND other.id <> @id
       AND other.status = 'pending'
       AND other.start_at < @end_at::timestamptz + (@buffer * interval '1 minute')
       AND other.end_at + (@buffer * interval '1 minute') > @start_at::timestamptz`,
  );

  const { startUtc, endUtc } = campusLocalDayRange(campusToday());
  const todayRows = (await db
    .prepare(
      `SELECT b.id, b.start_at, b.end_at, b.status,
         r.name AS room_name, p.display_name AS requester_name
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       JOIN profiles p ON p.id = b.requester_id
       WHERE ${scope}
         AND b.status IN ('approved', 'checked_in', 'completed', 'incident')
         AND b.start_at < ?
         AND b.end_at > ?
       ORDER BY b.start_at
       LIMIT 12`,
    )
    .all([...parameters, endUtc, startUtc])) as Array<{
    id: string;
    start_at: string;
    end_at: string;
    status: BookingStatus;
    room_name: string;
    requester_name: string;
  }>;

  const toReview = await count(
    `SELECT count(*) AS count FROM bookings b JOIN rooms r ON r.id = b.room_id
     WHERE ${scope} AND b.status = 'pending' AND b.start_at > ?`,
    nowIso,
  );
  const waitlisted = await count(
    `SELECT count(*) AS count FROM bookings b JOIN rooms r ON r.id = b.room_id
     WHERE ${scope} AND b.status = 'waitlisted' AND b.start_at > ?`,
    nowIso,
  );
  const inUse = await count(
    `SELECT count(*) AS count FROM bookings b JOIN rooms r ON r.id = b.room_id
     WHERE ${scope} AND b.status = 'checked_in' AND b.end_at >= ?`,
    nowIso,
  );
  const overdueRows = (await db
    .prepare(
      `SELECT b.id, b.end_at, r.name AS room_name, p.display_name AS requester_name
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       JOIN profiles p ON p.id = b.requester_id
       WHERE ${scope} AND b.status = 'checked_in' AND b.end_at < ?
       ORDER BY b.end_at`,
    )
    .all([...parameters, nowIso])) as Array<{
    id: string;
    end_at: string;
    room_name: string;
    requester_name: string;
  }>;
  const openIssues = await count(
    `SELECT count(*) AS count FROM incidents i
     JOIN bookings b ON b.id = i.booking_id JOIN rooms r ON r.id = b.room_id
     WHERE ${scope} AND i.status IN ('open', 'reviewing')`,
  );

  const actions: HomeAction[] = [];

  if (pendingRows[0] && Date.parse(pendingRows[0].start_at) - nowMs <= DAY) {
    actions.push({
      title: "A request starts within a day",
      detail: `${pendingRows[0].requester_name} · ${pendingRows[0].room_name} · ${formatCampusDateTime(
        pendingRows[0].start_at,
        pendingRows[0].end_at,
      )}. Decide now so they can plan.`,
      href: `/app/manager/requests/${pendingRows[0].id}`,
      cta: "Review",
      tone: "attention",
    });
  }

  for (const row of overdueRows.slice(0, 3)) {
    actions.push({
      title: `Not checked out: ${row.room_name}`,
      detail: `${row.requester_name}'s booking ended at ${formatCampusTime(row.end_at)}.`,
      href: `/app/manager/requests/${row.id}`,
      cta: "Open",
      tone: "problem",
    });
  }

  const roomsNeedingSetup =
    profile.role === "admin" || profile.role === "manager"
      ? ((await db
            .prepare(
              `SELECT r.id, r.name,
                 (SELECT count(*) FROM availability_rules a WHERE a.room_id = r.id AND a.active = 1) AS rule_count,
                 policy.requests_enabled
               FROM rooms r
               LEFT JOIN room_booking_policies policy ON policy.room_id = r.id
               WHERE ${scope} AND r.status = 'active'
               ORDER BY r.name`,
            )
            .all(parameters)) as Array<{
            id: string;
            name: string;
            rule_count: number;
            requests_enabled: number | null;
          }>)
          .filter((room) => room.rule_count === 0 || room.requests_enabled !== 1)
          .map((room) => ({
            id: room.id,
            name: room.name,
            problem:
              room.rule_count === 0
                ? "No opening hours, so nobody can request it."
                : "Not taking requests right now.",
          }))
      : [];

  return {
    actions,
    stats: [
      { label: "Requests to review", value: toReview, href: "/app/manager/queue", tone: toReview > 0 ? "attention" : "neutral" },
      { label: "On waitlists", value: waitlisted, href: "/app/manager/queue?status=waitlisted", tone: "neutral" },
      { label: "In use now", value: inUse, href: "/app/access/history", tone: "good" },
      {
        label: "Open issues",
        value: openIssues,
        href: "/app/incidents",
        tone: openIssues > 0 ? "attention" : "neutral",
      },
    ],
    decideSoon: await Promise.all(
      pendingRows.map(async (row) => ({
        id: row.id,
        roomName: row.room_name,
        requesterName: row.requester_name,
        when: formatCampusDateTime(row.start_at, row.end_at),
        status: row.status,
        note: null,
        href: `/app/manager/requests/${row.id}`,
        competing: (
          (await competing.get({
            room_id: row.room_id,
            id: row.id,
            start_at: row.start_at,
            end_at: row.end_at,
            buffer: row.buffer_minutes ?? 0,
          })) as { count: number }
        ).count,
      })),
    ),
    today: todayRows.map((row) => ({
      id: row.id,
      roomName: row.room_name,
      requesterName: row.requester_name,
      when: `${formatCampusTime(row.start_at)}–${formatCampusTime(row.end_at)}`,
      status: row.status,
      note: null,
      href: `/app/manager/requests/${row.id}`,
    })),
    roomsNeedingSetup,
  };
}
