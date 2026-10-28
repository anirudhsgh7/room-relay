export const ROLES = ["student", "manager", "admin"] as const;

export type Role = (typeof ROLES)[number];

export const PROFILE_STATUSES = ["active", "suspended"] as const;

export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

export const BOOKING_STATUSES = [
  "draft",
  "pending",
  "approved",
  "rejected",
  "waitlisted",
  "checked_in",
  "completed",
  "cancelled",
  "no_show",
  "incident",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const ACCESS_RESULTS = ["allowed", "denied"] as const;

export type AccessResult = (typeof ACCESS_RESULTS)[number];

export const ROLE_LABELS: Record<Role, string> = {
  student: "Student / club lead",
  manager: "Room manager",
  admin: "Administrator",
};

export const ROLE_SHORT_LABELS: Record<Role, string> = {
  student: "Student",
  manager: "Manager",
  admin: "Admin",
};

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  draft: "Draft",
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  waitlisted: "Waitlisted",
  checked_in: "Checked in",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
  incident: "Incident review",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLES.includes(value as Role);
}

export function isBookingStatus(value: unknown): value is BookingStatus {
  return (
    typeof value === "string" &&
    BOOKING_STATUSES.includes(value as BookingStatus)
  );
}
