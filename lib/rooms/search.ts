import type { CampusInterval } from "@/lib/time/campus-time";
import { parseCampusInterval } from "@/lib/time/campus-time";

export interface RoomSearchFilters {
  minCapacity: number | null;
  building: string | null;
  facilities: string[];
}

export interface RoomSearchValues {
  date: string;
  startTime: string;
  endTime: string;
  minCapacity: string;
  building: string;
  facilities: string[];
}

export type RoomSearchParseResult =
  | {
      ok: true;
      values: RoomSearchValues;
      interval: CampusInterval | null;
      hasFilters: boolean;
    }
  | {
      ok: false;
      values: RoomSearchValues;
      error: string;
    };

export interface RoomSearchFilters {
  minCapacity: number | null;
  building: string | null;
  facilities: string[];
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function all(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }

  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.map((item) => item.trim()).filter(Boolean))];
}

export const EMPTY_ROOM_SEARCH: RoomSearchValues = {
  date: "",
  startTime: "",
  endTime: "",
  minCapacity: "",
  building: "",
  facilities: [],
};

export function parseRoomSearchParams(
  raw: Record<string, string | string[] | undefined>,
): RoomSearchParseResult {
  const values: RoomSearchValues = {
    date: first(raw.date),
    startTime: first(raw.start),
    endTime: first(raw.end),
    minCapacity: first(raw.capacity),
    building: first(raw.building),
    facilities: all(raw.facility),
  };

  if (values.building.length > 120) {
    return { ok: false, values, error: "That building filter is too long." };
  }

  if (values.facilities.length > 12) {
    return { ok: false, values, error: "Select at most 12 facilities." };
  }

  if (values.facilities.some((facility) => facility.length > 80)) {
    return { ok: false, values, error: "That facility filter is too long." };
  }

  let minCapacity: number | null = null;
  if (values.minCapacity) {
    if (!/^\d{1,4}$/.test(values.minCapacity)) {
      return {
        ok: false,
        values,
        error: "Minimum capacity must be a whole number.",
      };
    }

    minCapacity = Number(values.minCapacity);
    if (minCapacity < 1) {
      return {
        ok: false,
        values,
        error: "Minimum capacity must be at least 1.",
      };
    }
  }

  const timeFields = [values.startTime, values.endTime].filter(Boolean);

  if (timeFields.length > 0 && timeFields.length < 2) {
    return {
      ok: false,
      values,
      error: "Enter both a start and end time, or clear both.",
    };
  }

  if ((values.startTime || values.endTime) && !values.date) {
    return {
      ok: false,
      values,
      error: "Choose a date to check a specific time.",
    };
  }

  let interval: CampusInterval | null = null;

  if (values.date && values.startTime && values.endTime) {
    const parsed = parseCampusInterval(
      values.date,
      values.startTime,
      values.endTime,
    );

    if (!parsed.ok) {
      return { ok: false, values, error: parsed.message };
    }

    interval = parsed.interval;
  }

  return {
    ok: true,
    values,
    interval,
    hasFilters:
      Boolean(
        values.date ||
          values.startTime ||
          values.endTime ||
          values.minCapacity ||
          values.building,
      ) || values.facilities.length > 0,
  };
}

export function toRoomSearchQuery(values: Partial<RoomSearchValues>): URLSearchParams {
  const params = new URLSearchParams();

  if (values.date) params.set("date", values.date);
  if (values.startTime) params.set("start", values.startTime);
  if (values.endTime) params.set("end", values.endTime);
  if (values.minCapacity) params.set("capacity", values.minCapacity);
  if (values.building) params.set("building", values.building);

  for (const facility of values.facilities ?? []) {
    params.append("facility", facility);
  }

  return params;
}
