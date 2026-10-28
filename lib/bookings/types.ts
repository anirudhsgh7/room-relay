import type { FieldErrors } from "@/lib/bookings/validation";
import type { BookingStatus } from "@/lib/domain";
import type { RoomRequirement } from "@/lib/rooms/types";

export interface EligibilityWarning {
  requirementId: string;
  description: string;
}

export interface SafeAlternative {
  date: string;
  startTime: string;
  endTime: string;
  label: string;
}

export interface BookingReceipt {
  id: string;
  roomCode: string;
  roomName: string;
  building: string;
  location: string;
  purpose: string;
  groupName: string | null;
  expectedAttendance: number;
  startAt: string;
  endAt: string;
  timeZone: string;
  status: BookingStatus;
  decisionReason: string | null;
  createdAt: string;
  eligibilityWarnings: EligibilityWarning[];
}

export type BookingResult =
  | {
      ok: true;
      kind: "created" | "existing";
      receipt: BookingReceipt;
      eligibilityWarnings: EligibilityWarning[];
    }
  | {
      ok: false;
      kind: "validation";
      message: string;
      fieldErrors: FieldErrors;
    }
  | {
      ok: false;
      kind: "conflict" | "outside_hours";
      message: string;
      alternatives: SafeAlternative[];
    }
  | {
      ok: false;
      kind: "duplicate";
      message: string;
      bookingId: string;
    }
  | {
      ok: false;
      kind: "unavailable" | "forbidden" | "rate_limited" | "idempotency_mismatch";
      message: string;
      retryAfterSeconds?: number;
    }
  | {
      ok: false;
      kind: "service_error";
      message: string;
      correlationId: string;
    };

export interface BookingEligibilitySnapshot {
  requirementId: string;
  description: string;
  required: boolean;
  status: RoomRequirement["verification"];
}
