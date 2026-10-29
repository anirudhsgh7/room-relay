import type { RoomPolicy } from "@/lib/rooms/types";

export const ALLOCATION_RULES = ["first_come", "best_fit", "fair_share"] as const;

export type AllocationRule = (typeof ALLOCATION_RULES)[number];

export function isAllocationRule(value: unknown): value is AllocationRule {
  return (
    typeof value === "string" &&
    ALLOCATION_RULES.includes(value as AllocationRule)
  );
}

/**
 * Published, plain-language wording of each allocation rule. The same text is
 * shown to requesters, reviewers, and administrators so everyone reads the
 * rule that the ranking code actually applies.
 */
export const ALLOCATION_RULE_COPY: Record<
  AllocationRule,
  { label: string; short: string; steps: string[] }
> = {
  first_come: {
    label: "First come, first served",
    short: "Earliest request wins.",
    steps: [
      "Requests that already meet every room requirement come first.",
      "Then the request submitted earliest.",
    ],
  },
  best_fit: {
    label: "Best use of space",
    short: "The group that best fills the room wins.",
    steps: [
      "Requests that already meet every room requirement come first.",
      "Then the request with the largest expected group (best use of the room's seats).",
      "Ties go to the request submitted earliest.",
    ],
  },
  fair_share: {
    label: "Fair share",
    short: "People who have used the room least recently go first.",
    steps: [
      "Requests that already meet every room requirement come first.",
      "Then the requester with the fewest confirmed hours in this room, counting the last 30 days and anything already booked ahead.",
      "Ties go to the request submitted earliest.",
    ],
  },
};

export const FAIR_SHARE_LOOKBACK_DAYS = 30;

export const DEFAULT_ROOM_POLICY: RoomPolicy = {
  requestsEnabled: true,
  slotIntervalMinutes: 30,
  minimumNoticeMinutes: 30,
  maximumDurationMinutes: 240,
  bufferMinutes: 0,
  maxAdvanceDays: 60,
  maxActivePerRequester: 0,
  allocationRule: "first_come",
  waitlistEnabled: true,
};

/** Columns selected from `room_booking_policies` aliased as `policy`. */
export const POLICY_SELECT_COLUMNS = `
  policy.requests_enabled,
  policy.slot_interval_minutes,
  policy.minimum_notice_minutes,
  policy.maximum_duration_minutes,
  policy.buffer_minutes,
  policy.max_advance_days,
  policy.max_active_per_requester,
  policy.allocation_rule,
  policy.waitlist_enabled
`;

export interface PolicyColumns {
  requests_enabled: number | null;
  slot_interval_minutes: number | null;
  minimum_notice_minutes: number | null;
  maximum_duration_minutes: number | null;
  buffer_minutes: number | null;
  max_advance_days: number | null;
  max_active_per_requester: number | null;
  allocation_rule: string | null;
  waitlist_enabled: number | null;
}

/**
 * Converts policy columns to a policy. A missing policy row means the room is
 * not configured, so requests are treated as disabled rather than open.
 */
export function policyFromColumns(row: PolicyColumns): RoomPolicy {
  return {
    requestsEnabled: row.requests_enabled === 1,
    slotIntervalMinutes:
      row.slot_interval_minutes ?? DEFAULT_ROOM_POLICY.slotIntervalMinutes,
    minimumNoticeMinutes:
      row.minimum_notice_minutes ?? DEFAULT_ROOM_POLICY.minimumNoticeMinutes,
    maximumDurationMinutes:
      row.maximum_duration_minutes ??
      DEFAULT_ROOM_POLICY.maximumDurationMinutes,
    bufferMinutes: row.buffer_minutes ?? DEFAULT_ROOM_POLICY.bufferMinutes,
    maxAdvanceDays: row.max_advance_days ?? DEFAULT_ROOM_POLICY.maxAdvanceDays,
    maxActivePerRequester:
      row.max_active_per_requester ?? DEFAULT_ROOM_POLICY.maxActivePerRequester,
    allocationRule: isAllocationRule(row.allocation_rule)
      ? row.allocation_rule
      : DEFAULT_ROOM_POLICY.allocationRule,
    waitlistEnabled:
      row.waitlist_enabled === null ? true : row.waitlist_enabled === 1,
  };
}

export function formatMinutes(minutes: number): string {
  if (minutes === 0) {
    return "none";
  }

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (rest === 0) {
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }

  return `${hours} h ${rest} min`;
}

export interface PolicyRuleLine {
  label: string;
  value: string;
}

/** The booking rules shown on room pages, in the order people need them. */
export function describePolicy(policy: RoomPolicy): PolicyRuleLine[] {
  return [
    {
      label: "Book ahead",
      value:
        policy.minimumNoticeMinutes === 0
          ? `Up to ${policy.maxAdvanceDays} days ahead`
          : `At least ${formatMinutes(policy.minimumNoticeMinutes)} and up to ${policy.maxAdvanceDays} days ahead`,
    },
    {
      label: "Longest booking",
      value: formatMinutes(policy.maximumDurationMinutes),
    },
    {
      label: "Start and end times",
      value: `On the ${policy.slotIntervalMinutes}-minute mark`,
    },
    {
      label: "Gap after each booking",
      value:
        policy.bufferMinutes === 0
          ? "None"
          : `${formatMinutes(policy.bufferMinutes)} for changeover`,
    },
    {
      label: "Upcoming requests per person",
      value:
        policy.maxActivePerRequester === 0
          ? "No limit"
          : `Up to ${policy.maxActivePerRequester} at a time`,
    },
    {
      label: "Waitlist",
      value: policy.waitlistEnabled
        ? "Open when a time is already booked"
        : "Not offered for this room",
    },
  ];
}
