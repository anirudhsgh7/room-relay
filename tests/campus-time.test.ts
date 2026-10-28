import { describe, expect, it } from "vitest";
import {
  addDaysToLocalDate,
  formatCampusDate,
  formatCampusTimeRange,
  localDateWeekday,
  parseCampusInterval,
} from "@/lib/time/campus-time";

const TIMEZONE = "Europe/London";

describe("campus-local time conversion", () => {
  it("converts a winter local interval to UTC", () => {
    const result = parseCampusInterval(
      "2026-10-29",
      "10:00",
      "11:30",
      TIMEZONE,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.interval.startUtc).toBe("2026-10-29T10:00:00Z");
      expect(result.interval.endUtc).toBe("2026-10-29T11:30:00Z");
      expect(result.interval.durationMinutes).toBe(90);
      expect(result.interval.weekday).toBe(4);
    }
  });

  it("accounts for British Summer Time", () => {
    const result = parseCampusInterval(
      "2026-07-15",
      "10:00",
      "11:30",
      TIMEZONE,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.interval.startUtc).toBe("2026-07-15T09:00:00Z");
      expect(result.interval.endUtc).toBe("2026-07-15T10:30:00Z");
    }
  });

  it("rejects a nonexistent local time in the spring DST gap", () => {
    const result = parseCampusInterval(
      "2027-03-28",
      "01:30",
      "02:30",
      TIMEZONE,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("dst_transition");
    }
  });

  it("rejects an ambiguous local time during the autumn fold", () => {
    const result = parseCampusInterval(
      "2026-10-25",
      "01:30",
      "02:30",
      TIMEZONE,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("dst_transition");
    }
  });

  it("rejects intervals where the end is not after the start", () => {
    const same = parseCampusInterval(
      "2026-10-29",
      "10:00",
      "10:00",
      TIMEZONE,
    );
    const reversed = parseCampusInterval(
      "2026-10-29",
      "11:00",
      "10:00",
      TIMEZONE,
    );

    expect(same.ok).toBe(false);
    expect(reversed.ok).toBe(false);
    if (!same.ok) expect(same.code).toBe("end_before_start");
    if (!reversed.ok) expect(reversed.code).toBe("end_before_start");
  });

  it("rejects malformed dates and times", () => {
    expect(parseCampusInterval("not-a-date", "10:00", "11:00", TIMEZONE).ok).toBe(
      false,
    );
    expect(parseCampusInterval("2026-10-29", "25:00", "26:00", TIMEZONE).ok).toBe(
      false,
    );
    expect(parseCampusInterval("2026-02-30", "10:00", "11:00", TIMEZONE).ok).toBe(
      false,
    );
  });

  it("formats dates and times in the configured campus timezone", () => {
    expect(formatCampusDate("2026-07-15T09:00:00Z", TIMEZONE)).toContain("15 Jul 2026");
    expect(
      formatCampusTimeRange(
        "2026-07-15T09:00:00Z",
        "2026-07-15T10:30:00Z",
        TIMEZONE,
      ),
    ).toBe("10:00–11:30");
  });

  it("supports deterministic local date helpers", () => {
    expect(addDaysToLocalDate("2026-10-29", 3)).toBe("2026-11-01");
    expect(localDateWeekday("2026-10-29")).toBe(4);
    expect(localDateWeekday("2026-11-01")).toBe(0);
  });
});
