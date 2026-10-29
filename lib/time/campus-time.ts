import { Temporal } from "@js-temporal/polyfill";
import { getCampusTimezone } from "@/lib/config";

export interface CampusInterval {
  timeZone: string;
  date: string;
  startUtc: string;
  endUtc: string;
  startEpochMs: number;
  endEpochMs: number;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  weekday: number;
  startLabel: string;
  endLabel: string;
  dateLabel: string;
}

export type IntervalParseFailure = {
  ok: false;
  code: "invalid_date_time" | "dst_transition" | "crosses_midnight" | "end_before_start";
  message: string;
};

export type IntervalParseResult =
  | { ok: true; interval: CampusInterval }
  | IntervalParseFailure;

function parseTimeParts(value: string): { hour: number; minute: number } | null {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    return null;
  }

  const [hour, minute] = value.split(":").map(Number);
  if (hour > 23 || minute > 59) {
    return null;
  }

  return { hour, minute };
}

function isDstTransitionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /disambigu|transition|ambig|nonexistent|does not exist|multiple/i.test(
    error.message,
  );
}

/**
 * Converts a campus-local date and start/end time into a UTC half-open
 * interval. Gaps and folds are rejected rather than silently shifted.
 */
export function parseCampusInterval(
  date: string,
  startTime: string,
  endTime: string,
  timeZone = getCampusTimezone(),
): IntervalParseResult {
  const startParts = parseTimeParts(startTime);
  const endParts = parseTimeParts(endTime);

  if (!startParts || !endParts) {
    return {
      ok: false,
      code: "invalid_date_time",
      message: "Enter a valid date and time.",
    };
  }

  let start: Temporal.ZonedDateTime;
  let end: Temporal.ZonedDateTime;
  let startDate: Temporal.PlainDate;

  try {
    startDate = Temporal.PlainDate.from(date, { overflow: "reject" });
  } catch {
    return {
      ok: false,
      code: "invalid_date_time",
      message: "Enter a valid date.",
    };
  }

  try {
    start = Temporal.ZonedDateTime.from(
      {
        timeZone,
        year: startDate.year,
        month: startDate.month,
        day: startDate.day,
        hour: startParts.hour,
        minute: startParts.minute,
        second: 0,
      },
      { disambiguation: "reject" },
    );

    end = Temporal.ZonedDateTime.from(
      {
        timeZone,
        year: startDate.year,
        month: startDate.month,
        day: startDate.day,
        hour: endParts.hour,
        minute: endParts.minute,
        second: 0,
      },
      { disambiguation: "reject" },
    );
  } catch (error) {
    return {
      ok: false,
      code: "dst_transition",
      message: isDstTransitionError(error)
        ? "That local time falls in a daylight-saving transition. Choose another time."
        : "That time is not valid in the campus timezone. Choose another time.",
    };
  }

  if (!start.toPlainDate().equals(startDate) || !end.toPlainDate().equals(startDate)) {
    return {
      ok: false,
      code: "crosses_midnight",
      message: "A request must start and end on the same campus-local date.",
    };
  }

  if (end.epochMilliseconds <= start.epochMilliseconds) {
    return {
      ok: false,
      code: "end_before_start",
      message: "The end time must be after the start time.",
    };
  }

  const startUtc = start.toInstant().toString();
  const endUtc = end.toInstant().toString();
  const dateLabel = formatCampusDate(startUtc, timeZone);

  return {
    ok: true,
    interval: {
      timeZone,
      date: startDate.toString(),
      startUtc,
      endUtc,
      startEpochMs: Number(start.epochMilliseconds),
      endEpochMs: Number(end.epochMilliseconds),
      startMinutes: start.hour * 60 + start.minute,
      endMinutes: end.hour * 60 + end.minute,
      durationMinutes: Number(
        (end.epochMilliseconds - start.epochMilliseconds) / 60_000,
      ),
      weekday: start.dayOfWeek % 7,
      startLabel: formatCampusTime(startUtc, timeZone),
      endLabel: formatCampusTime(endUtc, timeZone),
      dateLabel,
    },
  };
}

export function formatCampusDate(instant: string, timeZone = getCampusTimezone()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(instant));
}

export function formatCampusTime(instant: string, timeZone = getCampusTimezone()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(instant));
}

export function formatCampusTimeRange(
  startUtc: string,
  endUtc: string,
  timeZone = getCampusTimezone(),
): string {
  return `${formatCampusTime(startUtc, timeZone)}–${formatCampusTime(
    endUtc,
    timeZone,
  )}`;
}

export function formatCampusDateTime(
  startUtc: string,
  endUtc: string,
  timeZone = getCampusTimezone(),
): string {
  return `${formatCampusDate(startUtc, timeZone)} · ${formatCampusTimeRange(
    startUtc,
    endUtc,
    timeZone,
  )}`;
}

export function campusToday(timeZone = getCampusTimezone()): string {
  return Temporal.Now.instant()
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString();
}

export function addDaysToLocalDate(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}

export function localDateWeekday(date: string): number {
  return Temporal.PlainDate.from(date).dayOfWeek % 7;
}

export function nextWeekdayLocalDate(
  timeZone = getCampusTimezone(),
  minimumOffsetDays = 1,
): string {
  let date = Temporal.Now.instant()
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .add({ days: minimumOffsetDays });

  while (date.dayOfWeek === 6 || date.dayOfWeek === 7) {
    date = date.add({ days: 1 });
  }

  return date.toString();
}

export function localTimeParts(
  instant: string,
  timeZone = getCampusTimezone(),
): {
  date: string;
  weekday: number;
  minutes: number;
} {
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone);

  return {
    date: zoned.toPlainDate().toString(),
    weekday: zoned.dayOfWeek % 7,
    minutes: zoned.hour * 60 + zoned.minute,
  };
}

export function minutesToTime(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60)
    .toString()
    .padStart(2, "0");
  const minute = (normalized % 60).toString().padStart(2, "0");
  return `${hour}:${minute}`;
}

export interface LocalIntervalParts {
  date: string;
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  startTime: string;
  endTime: string;
  sameLocalDate: boolean;
}

export function localIntervalParts(
  startUtc: string,
  endUtc: string,
  timeZone = getCampusTimezone(),
): LocalIntervalParts {
  const start = Temporal.Instant.from(startUtc).toZonedDateTimeISO(timeZone);
  const end = Temporal.Instant.from(endUtc).toZonedDateTimeISO(timeZone);

  return {
    date: start.toPlainDate().toString(),
    weekday: start.dayOfWeek % 7,
    startMinutes: start.hour * 60 + start.minute,
    endMinutes: end.hour * 60 + end.minute,
    durationMinutes: Number(
      (end.epochMilliseconds - start.epochMilliseconds) / 60_000,
    ),
    startTime: minutesToTime(start.hour * 60 + start.minute),
    endTime: minutesToTime(end.hour * 60 + end.minute),
    sameLocalDate: start.toPlainDate().equals(end.toPlainDate()),
  };
}

export function campusLocalDayRange(
  date: string,
  timeZone = getCampusTimezone(),
): { startUtc: string; endUtc: string } {
  const localDate = Temporal.PlainDate.from(date, { overflow: "reject" });
  const start = localDate.toZonedDateTime({
    timeZone,
    plainTime: Temporal.PlainTime.from("00:00"),
  });
  const end = localDate
    .add({ days: 1 })
    .toZonedDateTime({
      timeZone,
      plainTime: Temporal.PlainTime.from("00:00"),
    });

  return {
    startUtc: start.toInstant().toString(),
    endUtc: end.toInstant().toString(),
  };
}

export function epochMilliseconds(instant: string): number {
  return Number(Temporal.Instant.from(instant).epochMilliseconds);
}

export function addMinutesToInstant(instant: string, minutes: number): string {
  return Temporal.Instant.from(instant)
    .add({ minutes })
    .toString();
}

/**
 * Converts a campus-local date and optional time to a UTC instant. Unlike
 * booking intervals, closures may span days, so a time inside a
 * daylight-saving gap resolves to the next valid instant instead of failing.
 * Returns null for an invalid date or time.
 */
export function campusLocalToUtc(
  date: string,
  time = "00:00",
  timeZone = getCampusTimezone(),
): string | null {
  const parts = parseTimeParts(time);

  if (!parts) {
    return null;
  }

  try {
    const plainDate = Temporal.PlainDate.from(date, { overflow: "reject" });
    const zoned = Temporal.ZonedDateTime.from(
      {
        timeZone,
        year: plainDate.year,
        month: plainDate.month,
        day: plainDate.day,
        hour: parts.hour,
        minute: parts.minute,
        second: 0,
      },
      { disambiguation: "compatible" },
    );

    return zoned.toInstant().toString();
  } catch {
    return null;
  }
}

/** The campus-local date (YYYY-MM-DD) and time (HH:MM) of a UTC instant. */
export function campusLocalParts(
  instant: string,
  timeZone = getCampusTimezone(),
): { date: string; time: string } {
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone);

  return {
    date: zoned.toPlainDate().toString(),
    time: minutesToTime(zoned.hour * 60 + zoned.minute),
  };
}
