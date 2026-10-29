import type { UserProfile } from "@/lib/auth/service";
import { listMyBookings, type MyBooking } from "@/lib/bookings/queries";
import { getWaitlistStanding } from "@/lib/bookings/waitlist";
import type { RoomRelayDatabase } from "@/lib/db/client";
import { BOOKING_STATUS_LABELS } from "@/lib/domain";
import { countUnreadNotifications } from "@/lib/notifications/service";
import {
  ALLOCATION_RULE_COPY,
  describePolicy,
  formatMinutes,
} from "@/lib/rooms/policy";
import {
  getRoomDetail,
  getRoomFilterOptions,
  searchRooms,
} from "@/lib/rooms/queries";
import type { RoomAvailabilityCode, RoomDetail, RoomSummary } from "@/lib/rooms/types";
import {
  addDaysToLocalDate,
  campusToday,
  formatCampusDate,
  formatCampusDateTime,
  formatCampusTime,
  localDateWeekday,
  parseCampusInterval,
  type CampusInterval,
} from "@/lib/time/campus-time";
import { parseQuery, type ParseContext, type ParsedQuery } from "@/lib/assistant/parse";

export type CardTone = "good" | "attention" | "problem" | "neutral";

export interface AssistantCard {
  title: string;
  subtitle: string;
  detail?: string;
  badge: string;
  tone: CardTone;
  href: string;
  cta: string;
}

export interface AssistantReply {
  /** Plain sentences; the UI renders each line as a paragraph. */
  message: string;
  cards: AssistantCard[];
  suggestions: string[];
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function reply(
  message: string,
  cards: AssistantCard[] = [],
  suggestions: string[] = [],
): AssistantReply {
  return { message, cards, suggestions };
}

function has(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function bookingTone(status: MyBooking["status"]): CardTone {
  switch (status) {
    case "approved":
    case "checked_in":
    case "completed":
      return "good";
    case "pending":
    case "waitlisted":
      return "attention";
    case "rejected":
    case "incident":
      return "problem";
    default:
      return "neutral";
  }
}

// ---------------------------------------------------------------------------
// Knowledge: answers grounded in how RoomRelay actually behaves.
// ---------------------------------------------------------------------------

interface Topic {
  match: RegExp;
  answer: (context: { profile: UserProfile; room: RoomDetail | null }) => AssistantReply;
}

const TOPICS: Topic[] = [
  {
    match: /\b(wait ?list|waiting list|queue for|slot (opens|frees)|if it frees)\b/,
    answer: () =>
      reply(
        [
          "If a time is already booked, you can join that room's waitlist from the request form.",
          "If the booking holding the time is cancelled (or ends early), every waitlisted request that now fits goes straight back to the room manager for review. You get a notification; you don't need to resubmit.",
          "Your place is shown on the request page. The order follows the room's published rule. If the time starts before it frees up, your waitlist place closes and you're told.",
        ].join("\n"),
        [],
        ["How are competing requests ranked?", "Show my requests"],
      ),
  },
  {
    match: /\b(rank|ranked|ranking|priority|prioriti[sz]e|fair|fairly|allocat\w*|who gets|competing|first come|someone else|same time|same slot|clash|two people|both want)\b/,
    answer: ({ room }) => {
      if (room) {
        const copy = ALLOCATION_RULE_COPY[room.policy.allocationRule];
        return reply(
          [
            `${room.name} uses "${copy.label}": ${copy.short}`,
            ...copy.steps.map((step, index) => `${index + 1}. ${step}`),
            "A manager can approve out of this order only by recording a reason, and the decision is logged.",
          ].join("\n"),
          [],
          [`Rules for ${room.code}`, "How does the waitlist work?"],
        );
      }

      return reply(
        [
          "When several requests want the same room at the same time, each room ranks them by its published rule:",
          ...Object.values(ALLOCATION_RULE_COPY).map(
            (copy) => `• ${copy.label}: ${copy.short}`,
          ),
          "Under every rule, requests that already meet the room's requirements come first. A manager can approve out of order only by recording a reason.",
          "Each room's rule is shown on its page.",
        ].join("\n"),
        [],
        ["How does the waitlist work?", "Find a room tomorrow afternoon"],
      );
    },
  },
  {
    match: /\b(cancel|cancellation|can't make it|cannot make it|no longer need)\b/,
    answer: () =>
      reply(
        [
          "Open the booking under My bookings and choose Cancel. Add a short reason.",
          "You can cancel a request at any time, and an approved booking up until it starts. Cancelling releases the time to anyone waitlisted.",
        ].join("\n"),
        [{ title: "My bookings", subtitle: "See and cancel your bookings", badge: "Open", tone: "neutral", href: "/app/bookings", cta: "Open" }],
      ),
  },
  {
    match: /\b(check ?in|checkin|tap|card|access|door|unlock|get in|enter)\b/,
    answer: () =>
      reply(
        [
          "Approval books the room; checking in starts your booking. When you arrive inside your booked time, open Check in, choose your card and the room, and tap.",
          "Check-in only works with an approved booking, inside its exact start and end time, with your own active card.",
          "In this version the door is simulated: no physical lock is opened.",
        ].join("\n"),
        [{ title: "Check in", subtitle: "Tap your card for a booked room", badge: "Open", tone: "neutral", href: "/app/access", cta: "Open" }],
      ),
  },
  {
    match: /\b(check ?out|checkout|leave|leaving|condition|wrap up|finish)\b/,
    answer: () =>
      reply(
        [
          "When you leave, open the booking and choose Check out. Say whether the room was left as you found it and add a short note.",
          "If something is wrong, choose Issue found and describe it. A manager reviews it and an administrator records the outcome. Nothing is decided automatically.",
          "You'll get a reminder shortly before your booking ends.",
        ].join("\n"),
        [],
        ["Show my requests"],
      ),
  },
  {
    match: /\b(incident|broken|damage|damaged|issue|problem with the room|report)\b/,
    answer: () =>
      reply(
        [
          "Report a room problem when you check out by choosing Issue found. Give the category and what you saw.",
          "The room manager reviews it first, then an administrator records the final resolution. You're notified at each step. No penalty is applied automatically.",
        ].join("\n"),
      ),
  },
  {
    match: /\b(eligib|induction|requirement|briefing|allowed to book|qualif)\b/,
    answer: ({ room }) => {
      if (room) {
        const required = room.requirements.filter((item) => item.required);
        if (required.length === 0) {
          return reply(`${room.name} has no special requirements. Anyone with a student account can request it.`);
        }

        return reply(
          [
            `${room.name} requires:`,
            ...required.map(
              (item) =>
                `• ${item.description}${
                  item.verification === "verified" ? " (you've completed this)" : ""
                }`,
            ),
            "You can still request it. The manager checks requirements before approving, and requests that already meet them are ranked first.",
          ].join("\n"),
        );
      }

      return reply(
        "Some rooms need something first, such as an equipment induction or safety briefing. You can still request them; the manager checks before approving, and requests that already meet the requirements are ranked first. Each room's page lists its requirements.",
      );
    },
  },
  {
    match: /\b(notification|notify|reminder|remind|alert|email|text me)\b/,
    answer: () =>
      reply(
        [
          "You'll get a notification here when a request is approved, declined, moved to or from a waitlist, or cancelled, and when an issue you reported is updated.",
          "Reminders arrive the day before a booking, again within the hour, and shortly before it ends so you remember to check out.",
          "Notifications are in the app (the bell at the top). Email and text delivery are not connected in this version.",
        ].join("\n"),
        [{ title: "Notifications", subtitle: "Everything sent to you", badge: "Open", tone: "neutral", href: "/app/notifications", cta: "Open" }],
      ),
  },
  {
    match: /\b(how long|when will|approval time|approved yet|still pending|hear back)\b/,
    answer: () =>
      reply(
        [
          "Room managers review requests in their queue. You're notified the moment there's a decision.",
          "If a request is still undecided a day before it starts, the manager gets an automatic nudge. A request is not a booking until it's approved.",
        ].join("\n"),
        [],
        ["Show my requests"],
      ),
  },
  {
    match: /\b(closure|closed|blackout|maintenance|shut)\b/,
    answer: ({ room }) => {
      if (room) {
        if (room.upcomingBlackouts.length === 0) {
          return reply(`${room.name} has no planned closures.`);
        }

        return reply(
          [
            `Planned closures for ${room.name}:`,
            ...room.upcomingBlackouts.map(
              (item) => `• ${formatCampusDateTime(item.startsAt, item.endsAt)}: ${item.reason}`,
            ),
          ].join("\n"),
        );
      }

      return reply(
        "Rooms can be closed for maintenance or events. A closure blocks new requests for that time, and anyone already booked is told why. Each room's page lists its planned closures.",
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Room search
// ---------------------------------------------------------------------------

const AVAILABILITY_COPY: Record<RoomAvailabilityCode, { badge: string; tone: CardTone }> = {
  available: { badge: "Free", tone: "good" },
  conflict: { badge: "Booked", tone: "problem" },
  blackout: { badge: "Closed", tone: "problem" },
  outside_hours: { badge: "Outside hours", tone: "neutral" },
  invalid_time: { badge: "Check times", tone: "attention" },
  not_requestable: { badge: "Not taking requests", tone: "neutral" },
};

function roomCard(
  room: RoomSummary,
  interval: CampusInterval | null,
  profile: UserProfile,
  people: number | null = null,
): AssistantCard {
  const params = new URLSearchParams();
  if (interval) {
    params.set("date", interval.date);
    params.set("start", interval.startLabel);
    params.set("end", interval.endLabel);
  }
  if (people && people <= room.capacity) {
    params.set("people", String(people));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const status = room.availability ? AVAILABILITY_COPY[room.availability] : null;
  const canRequest =
    profile.role === "student" &&
    (room.availability === "available" ||
      (room.availability === "conflict" && room.policy.waitlistEnabled));

  return {
    title: room.name,
    subtitle: `${room.building} · ${room.capacity} seats`,
    detail: room.facilities.slice(0, 3).join(" · ") || undefined,
    badge: status?.badge ?? `${room.capacity} seats`,
    tone: status?.tone ?? "neutral",
    href: canRequest
      ? `/app/rooms/${encodeURIComponent(room.code)}/request${query}`
      : `/app/rooms/${encodeURIComponent(room.code)}${query}`,
    cta:
      canRequest && room.availability === "available"
        ? "Request"
        : canRequest
          ? "Join waitlist"
          : "View",
  };
}

function describeSearch(parsed: ParsedQuery, interval: CampusInterval | null): string {
  const parts: string[] = [];

  if (interval) {
    parts.push(`${interval.dateLabel}, ${interval.startLabel}–${interval.endLabel}`);
  }
  if (parsed.capacity) {
    parts.push(`${parsed.capacity} ${parsed.capacity === 1 ? "person" : "people"}`);
  }
  if (parsed.facilities.length > 0) {
    parts.push(`with ${parsed.facilities.join(" and ").toLowerCase()}`);
  }
  if (parsed.building) {
    parts.push(`in ${parsed.building}`);
  }

  return parts.join(" · ");
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "30 Oct" — a date the parser reads back exactly. */
function chipDate(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${day} ${SHORT_MONTHS[month! - 1]}`;
}

/** Rebuilds a follow-up question that keeps the person's other needs. */
function searchPhrase(parsed: ParsedQuery, when: string): string {
  const needs = [
    parsed.capacity ? `for ${parsed.capacity} people` : "",
    parsed.facilities.length > 0
      ? `with ${parsed.facilities.join(" and ").toLowerCase()}`
      : "",
    parsed.building ? `in ${parsed.building}` : "",
  ].filter(Boolean);

  return ["Find a room", ...needs, when].join(" ");
}

async function findRooms(
  db: RoomRelayDatabase,
  profile: UserProfile,
  parsed: ParsedQuery,
): Promise<AssistantReply> {
  const filters = {
    minCapacity: parsed.capacity,
    building: parsed.building,
    facilities: parsed.facilities,
  };

  if (!parsed.date || !parsed.startTime || !parsed.endTime) {
    const rooms = (await searchRooms(db, profile, filters, null)).slice(0, 4);
    const missing =
      !parsed.date && !parsed.startTime ? "a day and time" : !parsed.date ? "a day" : "a time";

    if (rooms.length === 0) {
      return reply(
        "No rooms match those needs. Try fewer facilities or a smaller group.",
        [],
        ["Find a room for 6 people tomorrow at 2pm", "What rooms are there?"],
      );
    }

    const description = describeSearch(parsed, null);
    const day = parsed.date ? `on ${chipDate(parsed.date)}` : null;

    return reply(
      `${rooms.length === 1 ? "This room fits" : "These rooms fit"}${
        description ? ` (${description})` : ""
      }. Tell me ${missing} and I'll check which are free.`,
      rooms.map((room) => roomCard(room, null, profile)),
      day
        ? [
            searchPhrase(parsed, `${day} at 10am`),
            searchPhrase(parsed, `${day} at 2pm`),
            searchPhrase(parsed, `${day} at 6pm`),
          ]
        : parsed.startTime && parsed.endTime
          ? [
              searchPhrase(parsed, `today ${parsed.startTime}-${parsed.endTime}`),
              searchPhrase(parsed, `tomorrow ${parsed.startTime}-${parsed.endTime}`),
            ]
          : [
              searchPhrase(parsed, "tomorrow at 10am"),
              searchPhrase(parsed, "tomorrow at 2pm"),
              searchPhrase(parsed, "friday afternoon"),
            ],
    );
  }

  const parsedInterval = parseCampusInterval(parsed.date, parsed.startTime, parsed.endTime);

  if (!parsedInterval.ok) {
    return reply(`${parsedInterval.message} Try something like "tomorrow 2–4pm".`);
  }

  const interval = parsedInterval.interval;

  if (interval.endEpochMs <= Date.now()) {
    return reply(
      `${interval.dateLabel}, ${interval.startLabel}–${interval.endLabel} has already passed. Which day did you mean?`,
      [],
      [searchPhrase(parsed, `tomorrow ${parsed.startTime}-${parsed.endTime}`)],
    );
  }

  const rooms = await searchRooms(db, profile, filters, interval);
  const available = rooms.filter((room) => room.availability === "available");
  const summary = describeSearch(parsed, interval);

  if (rooms.length === 0) {
    const largest = (await searchRooms(
      db,
      profile,
      { minCapacity: null, building: parsed.building, facilities: parsed.facilities },
      null,
    )).reduce((max, room) => Math.max(max, room.capacity), 0);

    return reply(
      parsed.capacity && largest > 0 && largest < parsed.capacity
        ? `No room seats ${parsed.capacity}${
            parsed.facilities.length > 0 || parsed.building ? " with those needs" : ""
          }. The largest seats ${largest}.`
        : `No rooms match ${summary}. Try fewer facilities or a smaller group.`,
      [],
      ["What rooms are there?"],
    );
  }

  if (available.length > 0) {
    return reply(
      `${available.length === 1 ? "1 room is" : `${available.length} rooms are`} free for ${summary}.${
        profile.role === "student"
          ? " Choose one to send a request; the room manager approves it."
          : ""
      }`,
      available.slice(0, 4).map((room) => roomCard(room, interval, profile, parsed.capacity)),
    );
  }

  const invalid = rooms.find((room) => room.availability === "invalid_time");
  const waitlistable = rooms.filter(
    (room) => room.availability === "conflict" && room.policy.waitlistEnabled,
  );
  const allOffGrid = rooms.every((room) => room.availability === "invalid_time");
  const lines = allOffGrid
    ? [
        `Rooms are booked in ${invalid!.policy.slotIntervalMinutes}-minute steps, so ${interval.startLabel}–${interval.endLabel} can't be requested as it is. Try one of the times below.`,
      ]
    : [`Nothing is free for ${summary}.`];

  if (invalid && !allOffGrid) {
    lines.push(
      `Some rooms need start and end times on the ${invalid.policy.slotIntervalMinutes}-minute mark, or a shorter booking (up to ${formatMinutes(
        invalid.policy.maximumDurationMinutes,
      )}).`,
    );
  }

  if (waitlistable.length > 0 && profile.role === "student") {
    lines.push("You can join a waitlist for a booked room, or try another time.");
  }

  const startHour = Number(parsed.startTime.slice(0, 2));
  const duration = interval.durationMinutes;
  const laterStart = startHour + 1;
  const laterEndMinutes = laterStart * 60 + Number(parsed.startTime.slice(3)) + duration;
  const pad = (value: number) => value.toString().padStart(2, "0");
  const range = (startMinutes: number) =>
    `${pad(Math.floor(startMinutes / 60))}:${pad(startMinutes % 60)}-${pad(
      Math.floor((startMinutes + duration) / 60),
    )}:${pad((startMinutes + duration) % 60)}`;
  const startMinutes = startHour * 60 + Number(parsed.startTime.slice(3));
  const slot = invalid?.policy.slotIntervalMinutes ?? 30;
  const offGrid = startMinutes % slot !== 0 || duration % slot !== 0;
  const suggestions = offGrid
    ? (() => {
        // Snap to the room grid: round the start down and the length up.
        const snappedStart = Math.floor(startMinutes / slot) * slot;
        const snappedLength = Math.max(slot, Math.ceil(duration / slot) * slot);
        const snapped = (start: number) =>
          `${pad(Math.floor(start / 60))}:${pad(start % 60)}-${pad(
            Math.floor((start + snappedLength) / 60),
          )}:${pad((start + snappedLength) % 60)}`;
        return [
          searchPhrase(parsed, `on ${chipDate(parsed.date)} ${snapped(snappedStart)}`),
          searchPhrase(parsed, `on ${chipDate(parsed.date)} ${snapped(snappedStart + slot)}`),
        ];
      })()
    : [
        laterEndMinutes <= 22 * 60
          ? searchPhrase(parsed, `on ${chipDate(parsed.date)} ${range(startMinutes + 60)}`)
          : "",
        searchPhrase(
          parsed,
          `on ${chipDate(addDaysToLocalDate(parsed.date, 1))} ${range(startMinutes)}`,
        ),
      ].filter(Boolean);

  return reply(
    lines.join("\n"),
    (waitlistable.length > 0 ? waitlistable : rooms)
      .slice(0, 3)
      .map((item) => roomCard(item, interval, profile, parsed.capacity)),
    suggestions,
  );
}

/** One named room at one time: a direct yes or no with the reason. */
async function checkOneRoom(
  db: RoomRelayDatabase,
  profile: UserProfile,
  room: RoomDetail,
  parsed: ParsedQuery,
): Promise<AssistantReply> {
  if (!parsed.date || !parsed.startTime || !parsed.endTime) {
    return reply(
      `Which ${parsed.date ? "time" : "day"} should I check for ${room.name}?`,
      [],
      parsed.date
        ? [`Is ${room.code} free on ${chipDate(parsed.date)} at 10am?`, `Is ${room.code} free on ${chipDate(parsed.date)} at 2pm?`]
        : [`Is ${room.code} free tomorrow at 10am?`, `Is ${room.code} free tomorrow at 2pm?`],
    );
  }

  const parsedInterval = parseCampusInterval(parsed.date, parsed.startTime, parsed.endTime);

  if (!parsedInterval.ok) {
    return reply(`${parsedInterval.message} Try something like "tomorrow 2–4pm".`);
  }

  const interval = parsedInterval.interval;
  const when = `${interval.dateLabel}, ${interval.startLabel}–${interval.endLabel}`;

  if (interval.endEpochMs <= Date.now()) {
    return reply(`${when} has already passed. Which day did you mean?`);
  }

  const detail = await getRoomDetail(db, profile, room.code, interval);

  if (!detail) {
    return reply(`${room.name} isn't available to browse right now.`);
  }

  const message = (() => {
    switch (detail.availability) {
      case "available":
        return `Yes. ${room.name} is free ${when}.`;
      case "conflict":
        return `${room.name} is already booked ${when}.${
          detail.policy.waitlistEnabled && profile.role === "student"
            ? " You can join its waitlist from the request form."
            : ""
        }`;
      case "blackout":
        return `${room.name} is closed ${when}.`;
      case "outside_hours":
        return `That's outside ${room.name}'s opening hours. ${hoursSummary(detail)}`;
      case "invalid_time":
        return `${room.name} needs times on the ${detail.policy.slotIntervalMinutes}-minute mark and bookings of up to ${formatMinutes(
          detail.policy.maximumDurationMinutes,
        )}.`;
      default:
        return `${room.name} is not taking requests right now.`;
    }
  })();

  return reply(message, [roomCard(detail, interval, profile)]);
}

// ---------------------------------------------------------------------------
// Room facts
// ---------------------------------------------------------------------------

function hoursSummary(room: RoomDetail): string {
  if (room.hours.length === 0) {
    return "It has no opening hours set, so it can't be requested.";
  }

  const byDay = new Map<number, string>();
  for (const rule of room.hours) {
    byDay.set(rule.weekday, `${rule.opensAt}–${rule.closesAt}`);
  }

  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups: Array<{ days: number[]; hours: string }> = [];

  for (const day of order) {
    const hours = byDay.get(day);
    if (!hours) {
      continue;
    }

    const last = groups.at(-1);
    const previousDay = last ? last.days.at(-1)! : -1;
    const consecutive =
      last && last.hours === hours && order.indexOf(day) === order.indexOf(previousDay) + 1;

    if (consecutive) {
      last.days.push(day);
    } else {
      groups.push({ days: [day], hours });
    }
  }

  return `Open ${groups
    .map((group) =>
      group.days.length > 1
        ? `${WEEKDAY_NAMES[group.days[0]!]!.slice(0, 3)}–${WEEKDAY_NAMES[group.days.at(-1)!]!.slice(0, 3)} ${group.hours}`
        : `${WEEKDAY_NAMES[group.days[0]!]!.slice(0, 3)} ${group.hours}`,
    )
    .join(", ")}.`;
}

function roomFacts(room: RoomDetail): AssistantReply {
  const rules = describePolicy(room.policy);
  const rule = ALLOCATION_RULE_COPY[room.policy.allocationRule];
  const required = room.requirements.filter((item) => item.required);

  const lines = [
    `${room.name} (${room.code}) is in ${room.building}, ${room.location}. It seats ${room.capacity}.`,
    hoursSummary(room),
    room.facilities.length > 0 ? `Facilities: ${room.facilities.join(", ")}.` : "",
    `Booking rules: ${rules
      .map((line) => `${line.label.toLowerCase()} ${line.value.toLowerCase()}`)
      .join("; ")}.`,
    `Competing requests: ${rule.label} (${rule.short.toLowerCase().replace(/\.$/, "")}).`,
    required.length > 0
      ? `Requirements: ${required.map((item) => item.description).join("; ")}.`
      : "",
    room.upcomingBlackouts.length > 0
      ? `Planned closures: ${room.upcomingBlackouts
          .map((item) => `${formatCampusDateTime(item.startsAt, item.endsAt)} (${item.reason})`)
          .join("; ")}.`
      : "",
    room.policy.requestsEnabled ? "" : "It is not taking requests right now.",
  ].filter(Boolean);

  return reply(
    lines.join("\n"),
    [
      {
        title: room.name,
        subtitle: `${room.building} · ${room.capacity} seats`,
        badge: room.policy.requestsEnabled ? "Taking requests" : "Not taking requests",
        tone: room.policy.requestsEnabled ? "good" : "neutral",
        href: `/app/rooms/${encodeURIComponent(room.code)}`,
        cta: "Open room",
      },
    ],
    [`Is ${room.code} free tomorrow at 2pm?`],
  );
}

// ---------------------------------------------------------------------------
// Personal status
// ---------------------------------------------------------------------------

async function myStatus(db: RoomRelayDatabase, profile: UserProfile): Promise<AssistantReply> {
  const nowMs = Date.now();
  const bookings = (await listMyBookings(db, profile, 100)).filter(
    (booking) =>
      ["pending", "waitlisted", "approved", "checked_in", "incident"].includes(booking.status) &&
      (Date.parse(booking.endAt) > nowMs || booking.status === "checked_in" || booking.status === "incident"),
  );
  const unread = await countUnreadNotifications(db, profile.id);

  if (bookings.length === 0) {
    return reply(
      `You have nothing booked or waiting for a decision.${unread > 0 ? ` You have ${unread} unread notification${unread === 1 ? "" : "s"}.` : ""}`,
      [],
      ["Find a room tomorrow afternoon", "How does the waitlist work?"],
    );
  }

  const inUse = bookings.find((booking) => booking.status === "checked_in");
  const startedNotCheckedIn = bookings.find(
    (booking) =>
      booking.status === "approved" &&
      Date.parse(booking.startAt) <= nowMs &&
      Date.parse(booking.endAt) > nowMs,
  );
  const lines: string[] = [];

  if (startedNotCheckedIn) {
    lines.push(
      `Your ${startedNotCheckedIn.roomName} booking has started (until ${formatCampusTime(
        startedNotCheckedIn.endAt,
      )}). Check in when you arrive.`,
    );
  }

  if (inUse) {
    lines.push(
      `You're checked in to ${inUse.roomName} until ${formatCampusTime(
        inUse.endAt,
      )}. Remember to check out when you leave.`,
    );
  }

  const counts = {
    approved: bookings.filter((booking) => booking.status === "approved").length,
    pending: bookings.filter((booking) => booking.status === "pending").length,
    waitlisted: bookings.filter((booking) => booking.status === "waitlisted").length,
    incident: bookings.filter((booking) => booking.status === "incident").length,
  };
  const summary = [
    counts.approved ? `${counts.approved} confirmed` : "",
    counts.pending ? `${counts.pending} waiting for a decision` : "",
    counts.waitlisted ? `${counts.waitlisted} on a waitlist` : "",
    counts.incident
      ? `${counts.incident} with a reported issue under review`
      : "",
  ].filter(Boolean);

  if (summary.length > 0) {
    lines.push(`You have ${summary.join(", ")}.`);
  }

  if (unread > 0) {
    lines.push(`You have ${unread} unread notification${unread === 1 ? "" : "s"}.`);
  }

  // What needs doing now comes first, then everything else by start time.
  const urgency = (booking: MyBooking): number =>
    booking.status === "checked_in"
      ? 0
      : booking === startedNotCheckedIn
        ? 1
        : booking.status === "incident"
          ? 3
          : 2;
  const ordered = [...bookings].sort(
    (left, right) =>
      urgency(left) - urgency(right) || left.startAt.localeCompare(right.startAt),
  );

  const cards = await Promise.all(
    ordered.slice(0, 5).map(async (booking): Promise<AssistantCard> => {
    let detail: string | undefined;

    if (booking === startedNotCheckedIn) {
      detail = "Started — check in when you arrive";
    } else if (booking.status === "waitlisted") {
      const standing = await getWaitlistStanding(db, booking.id);
      detail = standing ? `Number ${standing.position} on the waitlist` : undefined;
    } else if (booking.status === "checked_in") {
      detail = "Check out when you leave";
    }

    return {
      title: booking.roomName,
      subtitle: formatCampusDateTime(booking.startAt, booking.endAt),
      detail,
      badge: BOOKING_STATUS_LABELS[booking.status],
      tone: bookingTone(booking.status),
      href: booking === startedNotCheckedIn ? "/app/access" : `/app/bookings/${booking.id}`,
      cta:
        booking.status === "checked_in"
          ? "Check out"
          : booking === startedNotCheckedIn
            ? "Check in"
            : "Open",
    };
    }),
  );

  return reply(lines.join("\n"), cards);
}

async function managerAttention(db: RoomRelayDatabase, profile: UserProfile): Promise<AssistantReply> {
  const nowIso = new Date().toISOString();
  const scope = profile.role === "admin" ? "1 = 1" : "r.manager_id = ?";
  const parameters = profile.role === "admin" ? [] : [profile.id];

  const pending = (await db
    .prepare(
      `SELECT b.id, b.start_at, b.end_at, r.name AS room_name, p.display_name AS requester_name
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       JOIN profiles p ON p.id = b.requester_id
       WHERE ${scope} AND b.status = 'pending' AND b.start_at > ?
       ORDER BY b.start_at
       LIMIT 50`,
    )
    .all([...parameters, nowIso])) as Array<{
    id: string;
    start_at: string;
    end_at: string;
    room_name: string;
    requester_name: string;
  }>;
  const overdue = (await db
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
  const incidents = (
    (await db
      .prepare(
        `SELECT count(*) AS count
         FROM incidents i
         JOIN bookings b ON b.id = i.booking_id
         JOIN rooms r ON r.id = b.room_id
         WHERE ${scope} AND i.status IN ('open', 'reviewing')`,
      )
      .get(parameters)) as { count: number }
  ).count;

  const lines: string[] = [];

  if (pending.length === 0 && overdue.length === 0 && incidents === 0) {
    lines.push("Nothing needs your attention right now.");
  } else {
    if (pending.length > 0) {
      lines.push(
        `${pending.length} request${pending.length === 1 ? " is" : "s are"} waiting for a decision. The soonest starts ${formatCampusDateTime(
          pending[0]!.start_at,
          pending[0]!.end_at,
        )}.`,
      );
    }
    if (overdue.length > 0) {
      lines.push(`${overdue.length} booking${overdue.length === 1 ? " has" : "s have"} ended without a check-out.`);
    }
    if (incidents > 0) {
      lines.push(`${incidents} reported issue${incidents === 1 ? " is" : "s are"} still open.`);
    }
  }

  const cards: AssistantCard[] = [
    ...pending.slice(0, 3).map((item) => ({
      title: `${item.requester_name} · ${item.room_name}`,
      subtitle: formatCampusDateTime(item.start_at, item.end_at),
      badge: "Needs decision",
      tone: "attention" as const,
      href: `/app/manager/requests/${item.id}`,
      cta: "Review",
    })),
    ...overdue.slice(0, 2).map((item) => ({
      title: `${item.requester_name} · ${item.room_name}`,
      subtitle: `Ended ${formatCampusDate(item.end_at)} at ${formatCampusTime(item.end_at)}`,
      badge: "Not checked out",
      tone: "problem" as const,
      href: `/app/manager/requests/${item.id}`,
      cta: "Open",
    })),
  ];

  if (incidents > 0) {
    cards.push({
      title: "Reported issues",
      subtitle: `${incidents} open`,
      badge: "Review",
      tone: "attention",
      href: "/app/incidents",
      cta: "Open",
    });
  }

  return reply(lines.join("\n"), cards);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const HELP_SUGGESTIONS: Record<UserProfile["role"], string[]> = {
  student: [
    "Find a room for 8 people tomorrow 2–4pm",
    "Show my requests",
    "How does the waitlist work?",
  ],
  manager: ["What needs my attention?", "How are competing requests ranked?", "Rules for SEM-02"],
  admin: ["What needs my attention?", "How are competing requests ranked?", "Find a room tomorrow at 10am"],
};

export const ASSISTANT_GREETING: Record<UserProfile["role"], string> = {
  student:
    "Hi! I can find a free room, explain booking rules, or check on your requests. Try asking in your own words.",
  manager:
    "Hi! I can tell you what needs your attention, explain how requests are ranked, or look up any room.",
  admin:
    "Hi! I can summarise what needs attention across campus, explain the booking rules, or look up any room.",
};

export function assistantSuggestions(role: UserProfile["role"]): string[] {
  return HELP_SUGGESTIONS[role];
}

export const MAX_ASSISTANT_MESSAGE = 400;

export async function answerAssistant(
  db: RoomRelayDatabase,
  profile: UserProfile,
  message: string,
): Promise<AssistantReply> {
  const trimmed = message.trim().slice(0, MAX_ASSISTANT_MESSAGE);

  if (!trimmed) {
    return reply(ASSISTANT_GREETING[profile.role], [], HELP_SUGGESTIONS[profile.role]);
  }

  const options = await getRoomFilterOptions(db);
  const rooms = (await db
    .prepare("SELECT code, name FROM rooms WHERE status = 'active' ORDER BY code")
    .all()) as Array<{ code: string; name: string }>;
  const today = campusToday();
  const context: ParseContext = {
    today,
    todayWeekday: localDateWeekday(today),
    facilities: options.facilities,
    buildings: options.buildings,
    rooms,
  };
  const parsed = parseQuery(trimmed, context);
  const text = parsed.normalized;
  const room = parsed.roomCode
    ? await getRoomDetail(db, profile, parsed.roomCode, null)
    : null;

  if (
    has(text, /^(hi|hello|hey|hiya|yo|good (morning|afternoon|evening)|help|\?)$/) ||
    has(text, /\b(what can you do|how do i use (this|you|roomrelay)|what do you do)\b/)
  ) {
    return reply(ASSISTANT_GREETING[profile.role], [], HELP_SUGGESTIONS[profile.role]);
  }

  if (has(text, /^(thanks|thank you|thx|cheers|ok|okay|great|perfect|cool)\b/)) {
    return reply("You're welcome. Anything else?", [], HELP_SUGGESTIONS[profile.role]);
  }

  const asksHow = has(text, /\b(how|why|can i|could i|what happens|what if|explain|rules? (for|about|on)|policy)\b/);
  const wantsSearch =
    has(text, /\b(find|book|need|looking for|available|free|any room|a room|space for|somewhere)\b/) &&
    !asksHow;
  const hasSearchTerms =
    parsed.date !== null ||
    parsed.startTime !== null ||
    parsed.capacity !== null ||
    parsed.facilities.length > 0;

  if (
    (profile.role === "manager" || profile.role === "admin") &&
    !wantsSearch &&
    !asksHow &&
    has(text, /\b(attention|to ?do|queue|pending|waiting|overdue|what's up|whats up|summary|my day|anything new)\b/)
  ) {
    return await managerAttention(db, profile);
  }

  const asksStatus =
    has(text, /\b(show|list|see|check|what are|what's|whats|status)\b.*\bmy\b|\bmy (status|schedule)\b|\b(am i booked|what have i booked|upcoming|my next|next booking)\b/) ||
    has(text, /^my (bookings?|requests?|reservations?)$/);

  if (asksStatus && !asksHow) {
    return profile.role === "student" ? await myStatus(db, profile) : await managerAttention(db, profile);
  }

  if (room && !asksHow && (parsed.date || parsed.startTime || has(text, /\b(free|available|booked)\b/))) {
    return await checkOneRoom(db, profile, room, parsed);
  }

  for (const topic of TOPICS) {
    if (topic.match.test(text) && !(wantsSearch && hasSearchTerms)) {
      return topic.answer({ profile, room });
    }
  }

  if (room) {
    return roomFacts(room);
  }

  if (has(text, /\b(what|which|list|show)( are the)? (rooms|spaces)\b|\ball (the )?rooms\b/)) {
    const all = await searchRooms(
      db,
      profile,
      { minCapacity: parsed.capacity, building: parsed.building, facilities: parsed.facilities },
      null,
    );
    return reply(
      `There ${all.length === 1 ? "is 1 room" : `are ${all.length} rooms`} you can browse${
        parsed.building ? ` in ${parsed.building}` : ""
      }. Tell me a day, time, and group size and I'll check which are free.`,
      all.slice(0, 5).map((item) => roomCard(item, null, profile)),
      ["Find a room for 6 people tomorrow at 2pm"],
    );
  }

  if (wantsSearch || hasSearchTerms) {
    return await findRooms(db, profile, parsed);
  }

  return reply(
    "I'm not sure I understood. I can find free rooms, explain booking rules, or check on requests. Here are some things you can ask:",
    [],
    HELP_SUGGESTIONS[profile.role],
  );
}
