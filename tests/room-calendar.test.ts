import { describe, expect, it } from "vitest";
import {
  addDaysToCalendarDate,
  formatCalendarDate,
  getCalendarDateCells,
  parseCalendarDate,
  shiftCalendarMonth,
} from "@/lib/rooms/calendar";

describe("room search calendar dates", () => {
  it("builds a Monday-first grid with adjacent-month dates", () => {
    const cells = getCalendarDateCells(2026, 11);

    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual({
      date: "2026-10-26",
      day: 26,
      inCurrentMonth: false,
    });
    expect(cells[6]).toEqual({
      date: "2026-11-01",
      day: 1,
      inCurrentMonth: true,
    });
    expect(cells[41]).toEqual({
      date: "2026-12-06",
      day: 6,
      inCurrentMonth: false,
    });
  });

  it("handles leap days, date shifts, and month boundaries", () => {
    const february = getCalendarDateCells(2028, 2);

    expect(february.find((cell) => cell.date === "2028-02-29")).toMatchObject({
      day: 29,
      inCurrentMonth: true,
    });
    expect(addDaysToCalendarDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftCalendarMonth(2027, 1, -1)).toEqual({ year: 2026, month: 12 });
  });

  it("validates and formats dates without using the device timezone", () => {
    expect(parseCalendarDate("2026-11-30")).toEqual({ year: 2026, month: 11 });
    expect(parseCalendarDate("2026-02-30")).toBeNull();
    expect(formatCalendarDate("2026-10-30")).toBe("Fri, 30 Oct 2026");
  });
});
