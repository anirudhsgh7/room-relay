import type { AccessResult } from "@/lib/domain";

export const ACCESS_REASON_MESSAGES: Record<string, string> = {
  ACCESS_ALLOWED: "Access check allowed for your approved booking.",
  UNKNOWN_CREDENTIAL: "This credential is not recognized for your account.",
  CREDENTIAL_NOT_OWNED: "This credential cannot be used by this account.",
  CREDENTIAL_REVOKED:
    "This credential has been revoked. Contact a room administrator.",
  ACCOUNT_INACTIVE: "This account is not active for access checks.",
  ROOM_NOT_FOUND: "This room is not available for an access check.",
  ROOM_INACTIVE: "This room is not currently active.",
  NO_APPROVED_BOOKING: "No approved booking for this room at this time.",
  BOOKING_NOT_APPROVED: "This booking is not approved for access.",
  OUTSIDE_BOOKING_WINDOW:
    "This attempt is outside your approved booking window.",
  RATE_LIMITED: "Too many attempts. Wait briefly and try again.",
  REPLAYED_ATTEMPT:
    "This tap was already processed. Start a new access check.",
  SERVICE_UNAVAILABLE:
    "Access service is unavailable. No access was granted.",
  // Historical seeded reason code retained for readable access history.
  WITHIN_APPROVED_WINDOW: "Access check allowed inside the approved window.",
};

export type AccessReasonCode = keyof typeof ACCESS_REASON_MESSAGES;

export interface AccessCheckResponse {
  decision: "ALLOW" | "DENY";
  reasonCode: AccessReasonCode;
  message: string;
  source: "SIMULATED";
  replayed: boolean;
  eventId: string | null;
  occurredAt: string;
  bookingId?: string | null;
  bookingStatus?: string | null;
}

export interface AccessCheckResult {
  bookingId: string | null;
  bookingStatus: string | null;
  actorId: string;
  roomId: string;
  result: AccessResult;
  reasonCode: AccessReasonCode;
  occurredAt: string;
}
