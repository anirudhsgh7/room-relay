export interface RoomPolicy {
  requestsEnabled: boolean;
  slotIntervalMinutes: number;
  minimumNoticeMinutes: number;
  maximumDurationMinutes: number;
  bufferMinutes: number;
}

export interface RoomRequirement {
  id: string;
  requirementType: string;
  description: string;
  required: boolean;
  verification: "verified" | "unverified" | "expired" | null;
}

export type RoomAvailabilityCode =
  | "available"
  | "conflict"
  | "outside_hours"
  | "invalid_time"
  | "not_requestable";

export interface RoomSummary {
  id: string;
  code: string;
  name: string;
  building: string;
  location: string;
  capacity: number;
  facilities: string[];
  policySummary: string;
  policy: RoomPolicy;
  availability: RoomAvailabilityCode | null;
  requiredRequirementCount: number;
  hasUnverifiedRequiredRequirement: boolean;
}

export interface RoomDetail extends Omit<RoomSummary, "availability"> {
  availability: RoomAvailabilityCode | null;
  hours: RoomHours[];
  requirements: RoomRequirement[];
}

export interface RoomHours {
  weekday: number;
  opensAt: string;
  closesAt: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
}
