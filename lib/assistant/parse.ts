/**
 * Turns a plain-language message into structured search terms. The parser is
 * deliberately conservative: anything it cannot read with confidence is left
 * empty so the assistant asks, rather than guessing a time or a date.
 */

export interface ParsedQuery {
  normalized: string;
  date: string | null;
  dateLabel: string | null;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
  capacity: number | null;
  facilities: string[];
  building: string | null;
  roomCode: string | null;
}

export interface ParseContext {
  /** Campus-local today, YYYY-MM-DD. */
  today: string;
  /** 0 = Sunday … 6 = Saturday, for `today`. */
  todayWeekday: number;
  facilities: string[];
  buildings: string[];
  rooms: Array<{ code: string; name: string }>;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/** Common ways people describe the facilities rooms actually list. */
const FACILITY_SYNONYMS: Array<{ pattern: RegExp; facility: string }> = [
  { pattern: /\b(projector|beamer|presentation|slides)\b/, facility: "projector" },
  { pattern: /\b(white ?board|whiteboards)\b/, facility: "whiteboard" },
  { pattern: /\b(camera|filming|film|video|record(ing)?)\b/, facility: "camera" },
  { pattern: /\bgreen ?screen\b/, facility: "green screen" },
  { pattern: /\b(acoustic|soundproof|sound proof|quiet recording)\b/, facility: "acoustic" },
  { pattern: /\b(hearing loop|induction loop)\b/, facility: "hearing loop" },
  { pattern: /\b(step[- ]?free|wheelchair|accessible|ramp|no stairs)\b/, facility: "step-free" },
  { pattern: /\b(power|sockets?|outlets?|charging)\b/, facility: "power" },
  { pattern: /\b(hybrid|video ?call|zoom|teams meeting|conference kit)\b/, facility: "hybrid" },
  { pattern: /\b(worktables?|work tables?|workbench(es)?)\b/, facility: "worktable" },
];

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day!));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function isValidDate(year: number, month: number, day: number): boolean {
  const value = new Date(Date.UTC(year, month - 1, day));
  return (
    value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day
  );
}

/** The next occurrence of a date with no year, never in the past. */
function nextDate(today: string, month: number, day: number): string | null {
  const year = Number(today.slice(0, 4));

  for (const candidateYear of [year, year + 1]) {
    if (isValidDate(candidateYear, month, day)) {
      const candidate = `${candidateYear}-${pad(month)}-${pad(day)}`;
      if (candidate >= today) {
        return candidate;
      }
    }
  }

  return null;
}

function parseDate(
  text: string,
  context: ParseContext,
): { date: string; label: string } | null {
  if (/\b(day after tomorrow)\b/.test(text)) {
    return { date: addDays(context.today, 2), label: "the day after tomorrow" };
  }

  if (/\b(tomorrow|tmrw|tmr)\b/.test(text)) {
    return { date: addDays(context.today, 1), label: "tomorrow" };
  }

  if (/\b(today|tonight|this (morning|afternoon|evening))\b/.test(text)) {
    return { date: context.today, label: "today" };
  }

  const inDays = text.match(/\bin (\d{1,2}) days?\b/);
  if (inDays) {
    const days = Number(inDays[1]);
    return { date: addDays(context.today, days), label: `in ${days} days` };
  }

  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    if (isValidDate(year, month, day)) {
      return { date: `${year}-${pad(month)}-${pad(day)}`, label: "" };
    }
  }

  // Day before month: "30 oct", "30th of october".
  const dayMonth = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?(?: of)? (jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/,
  );
  // Month before day: "oct 30", "october 30th".
  const monthDay = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?) (\d{1,2})(?:st|nd|rd|th)?\b/,
  );

  if (dayMonth || monthDay) {
    const day = Number(dayMonth ? dayMonth[1] : monthDay![2]);
    const month = MONTHS[dayMonth ? dayMonth[2]! : monthDay![1]!]!;
    const date = nextDate(context.today, month, day);
    if (date) {
      return { date, label: "" };
    }
  }

  // Numeric day/month as used on campus forms: "30/10" or "30/10/2026".
  const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const year = numeric[3] ? Number(numeric[3]) : null;

    if (year !== null && isValidDate(year, month, day)) {
      return { date: `${year}-${pad(month)}-${pad(day)}`, label: "" };
    }

    if (year === null) {
      const date = nextDate(context.today, month, day);
      if (date) {
        return { date, label: "" };
      }
    }
  }

  const weekday = text.match(
    /\b(next |this |on )?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/,
  );
  if (weekday) {
    const target = WEEKDAYS[weekday[2]!]!;
    let offset = (target - context.todayWeekday + 7) % 7;

    if (weekday[1]?.trim() === "next" && offset === 0) {
      offset = 7;
    }

    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return {
      date: addDays(context.today, offset),
      label: offset === 0 ? "today" : offset === 1 ? "tomorrow" : names[target]!,
    };
  }

  return null;
}

interface ClockTime {
  minutes: number;
  explicitMeridiem: boolean;
}

function toMinutes(hour: number, minute: number, meridiem: string | undefined): ClockTime | null {
  if (minute > 59 || hour > 23) {
    return null;
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return null;
    }

    const isPm = meridiem.startsWith("p");
    const adjusted = hour % 12 + (isPm ? 12 : 0);
    return { minutes: adjusted * 60 + minute, explicitMeridiem: true };
  }

  return { minutes: hour * 60 + minute, explicitMeridiem: hour > 12 || hour === 0 };
}

/**
 * Bare hours from 1 to 7 almost always mean the afternoon or evening on a
 * campus ("at 3"); 8 to 11 mean the morning. Explicit am/pm always wins.
 */
function campusHour(time: ClockTime): number {
  if (time.explicitMeridiem) {
    return time.minutes;
  }

  const hour = Math.floor(time.minutes / 60);
  return hour >= 1 && hour <= 7 ? time.minutes + 12 * 60 : time.minutes;
}

function minutesToClock(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

const TIME = String.raw`(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?`;

function parseTimes(text: string): {
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
} {
  let durationMinutes: number | null = null;
  const hours = text.match(/\bfor (an?|one|\d+(?:\.\d+)?|half an?) ?(hours?|hrs?|h)\b/);
  const minutes = text.match(/\bfor (\d{2,3}) ?(minutes|mins|min)\b/);

  if (hours) {
    const amount = hours[1]!;
    durationMinutes =
      amount === "a" || amount === "an" || amount === "one"
        ? 60
        : amount.startsWith("half")
          ? 30
          : Math.round(Number(amount) * 60);
  } else if (minutes) {
    durationMinutes = Number(minutes[1]);
  }

  // Remove duration phrases so "for 2 hours" is not read as a 2 o'clock time.
  const withoutDuration = text
    .replace(/\bfor (an?|one|\d+(?:\.\d+)?|half an?) ?(hours?|hrs?|h)\b/g, " ")
    .replace(/\bfor (\d{2,3}) ?(minutes|mins|min)\b/g, " ");

  const range = withoutDuration.match(
    new RegExp(String.raw`\b(?:from |between )?${TIME}\s*(?:-|–|to|until|till|and)\s*${TIME}`),
  );

  if (range) {
    const [, h1, m1, mer1, h2, m2, mer2] = range;
    const second = toMinutes(Number(h2), Number(m2 ?? 0), mer2?.replaceAll(".", ""));
    let first = toMinutes(Number(h1), Number(m1 ?? 0), mer1?.replaceAll(".", ""));

    // "3-5pm": the second time's am/pm applies to the first when that keeps
    // the range forward.
    if (first && second && !first.explicitMeridiem && mer2) {
      const shared = toMinutes(Number(h1), Number(m1 ?? 0), mer2.replaceAll(".", ""));
      if (shared && shared.minutes < second.minutes) {
        first = shared;
      }
    }

    if (first && second) {
      let start = campusHour(first);
      let end = campusHour(second);

      if (!second.explicitMeridiem && end <= start && end + 12 * 60 < 24 * 60) {
        end += 12 * 60;
      }
      if (!first.explicitMeridiem && start >= end && start - 12 * 60 >= 0) {
        start -= 12 * 60;
      }

      if (end > start) {
        return {
          startTime: minutesToClock(start),
          endTime: minutesToClock(end),
          durationMinutes: end - start,
        };
      }
    }
  }

  const single =
    withoutDuration.match(new RegExp(String.raw`\b(?:at|from|starting|around|by) ${TIME}`)) ??
    withoutDuration.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/) ??
    withoutDuration.match(/\b(\d{1,2})[:.](\d{2})\b/);

  if (single) {
    const time = toMinutes(Number(single[1]), Number(single[2] ?? 0), single[3]?.replaceAll(".", ""));

    if (time) {
      const start = campusHour(time);
      const duration = durationMinutes ?? 60;
      const end = start + duration;

      if (end <= 24 * 60) {
        return {
          startTime: minutesToClock(start),
          endTime: minutesToClock(end === 24 * 60 ? 23 * 60 + 59 : end),
          durationMinutes: duration,
        };
      }
    }
  }

  const partOfDay: Array<[RegExp, number, number]> = [
    [/\bmorning\b/, 9 * 60, 12 * 60],
    [/\b(lunch ?time|midday|noon)\b/, 12 * 60, 13 * 60],
    [/\bafternoon\b/, 13 * 60, 17 * 60],
    [/\b(evening|tonight)\b/, 18 * 60, 21 * 60],
  ];

  for (const [pattern, start, end] of partOfDay) {
    if (pattern.test(withoutDuration)) {
      const length = durationMinutes ?? end - start;
      return {
        startTime: minutesToClock(start),
        endTime: minutesToClock(Math.min(start + length, 23 * 60 + 59)),
        durationMinutes: length,
      };
    }
  }

  return { startTime: null, endTime: null, durationMinutes };
}

function parseCapacity(text: string): number | null {
  const patterns = [
    /\b(\d{1,4}) ?(?:people|persons|ppl|students|attendees|members|guests|participants|seats|of us|pax)\b/,
    /\b(?:group|team|class|party|meeting) of (\d{1,4})\b/,
    /\b(?:for|fits|fit|seat|seats|holds?) (\d{1,4})\b(?! ?(?:h|hr|hrs|hours?|mins?|minutes|am|pm|:|\.\d))/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (value >= 1 && value <= 5000) {
        return value;
      }
    }
  }

  return null;
}

function parseFacilities(text: string, available: string[]): string[] {
  const found = new Set<string>();

  for (const facility of available) {
    if (text.includes(facility.toLowerCase())) {
      found.add(facility);
    }
  }

  for (const { pattern, facility } of FACILITY_SYNONYMS) {
    if (pattern.test(text)) {
      const match = available.find((item) => item.toLowerCase().includes(facility));
      if (match) {
        found.add(match);
      }
    }
  }

  return [...found];
}

function parseBuilding(text: string, buildings: string[]): string | null {
  for (const building of buildings) {
    const lower = building.toLowerCase();
    const firstWord = lower.split(/\s+/)[0]!;

    if (text.includes(lower) || (firstWord.length >= 5 && new RegExp(`\\b${firstWord}\\b`).test(text))) {
      return building;
    }
  }

  return null;
}

function parseRoom(
  text: string,
  rooms: ParseContext["rooms"],
): string | null {
  for (const room of rooms) {
    const code = room.code.toLowerCase();
    if (new RegExp(`\\b${code.replace(/[-]/g, "[- ]?")}\\b`).test(text)) {
      return room.code;
    }
  }

  // Longest names first so "Seminar Room 02" wins over a shorter overlap.
  const byLength = [...rooms].sort((left, right) => right.name.length - left.name.length);

  for (const room of byLength) {
    const name = room.name.toLowerCase();
    const withoutNumber = name.replace(/\s+\d+$/, "");

    if (text.includes(name) || (withoutNumber.length >= 6 && text.includes(withoutNumber))) {
      return room.code;
    }
  }

  return null;
}

export function parseQuery(message: string, context: ParseContext): ParsedQuery {
  const normalized = message
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[?!,;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const date = parseDate(normalized, context);
  // Dates and room codes contain digit-dash-digit runs ("2026-11-02",
  // "sem-02") that would otherwise read as time ranges.
  const timeText = normalized
    .replace(/\b20\d{2}-\d{1,2}-\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/20\d{2})?\b/g, " ")
    .replace(/\b[a-z]{2,5}-[a-z]?\d{1,3}\b/g, " ");
  const times = parseTimes(timeText);

  return {
    normalized,
    date: date?.date ?? null,
    dateLabel: date?.label || null,
    startTime: times.startTime,
    endTime: times.endTime,
    durationMinutes: times.durationMinutes,
    capacity: parseCapacity(normalized),
    facilities: parseFacilities(normalized, context.facilities),
    building: parseBuilding(normalized, context.buildings),
    roomCode: parseRoom(normalized, context.rooms),
  };
}
