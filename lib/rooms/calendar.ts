export interface CalendarMonth {
  year: number;
  month: number;
}

export interface CalendarDateCell {
  date: string;
  day: number;
  inCurrentMonth: boolean;
}

function utcDate(year: number, monthIndex: number, day: number): Date {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, monthIndex, day);
  return date;
}

function toDateString(date: Date): string {
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")}`;
}

export function parseCalendarDate(value: string): CalendarMonth | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = utcDate(year, month - 1, day);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month };
}

export function getCalendarDateCells(
  year: number,
  month: number,
): CalendarDateCell[] {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError("Calendar month must be a valid year and month.");
  }

  const firstOfMonth = utcDate(year, month - 1, 1);
  // Monday-first calendar: Sunday (0) becomes the final day of the week.
  const mondayOffset = (firstOfMonth.getUTCDay() + 6) % 7;
  const firstCell = utcDate(year, month - 1, 1 - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = utcDate(
      firstCell.getUTCFullYear(),
      firstCell.getUTCMonth(),
      firstCell.getUTCDate() + index,
    );

    return {
      date: toDateString(date),
      day: date.getUTCDate(),
      inCurrentMonth:
        date.getUTCFullYear() === year && date.getUTCMonth() === month - 1,
    };
  });
}

export function shiftCalendarMonth(
  year: number,
  month: number,
  offset: number,
): CalendarMonth {
  const shifted = utcDate(year, month - 1 + offset, 1);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

export function addDaysToCalendarDate(value: string, offset: number): string | null {
  const month = parseCalendarDate(value);

  if (!month || !Number.isInteger(offset)) {
    return null;
  }

  const [, , day] = value.split("-").map(Number);
  const shifted = utcDate(month.year, month.month - 1, day! + offset);
  return toDateString(shifted);
}

export function formatCalendarDate(value: string): string | null {
  if (!parseCalendarDate(value)) {
    return null;
  }

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export function formatCalendarMonth(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcDate(year, month - 1, 1));
}
