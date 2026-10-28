import type { UserProfile } from "@/lib/auth/service";

/**
 * Central authorization helpers. Phase 1 has no booking mutation routes yet,
 * but these functions define the intended trust boundary so later phases do not
 * reinvent role checks inside UI components.
 */

export interface RoomAssignment {
  id: string;
  managerId: string;
}

export interface BookingScope {
  requesterId: string;
  room: RoomAssignment;
}

export function isActiveProfile(profile: UserProfile | null): profile is UserProfile {
  return profile?.status === "active";
}

export function canManageRoom(
  profile: UserProfile,
  room: RoomAssignment,
): boolean {
  if (!isActiveProfile(profile)) {
    return false;
  }

  if (profile.role === "admin") {
    return true;
  }

  return profile.role === "manager" && room.managerId === profile.id;
}

export function canApproveOrRejectBooking(
  profile: UserProfile,
  room: RoomAssignment,
): boolean {
  return canManageRoom(profile, room);
}

export function canViewBookingDetails(
  profile: UserProfile,
  booking: BookingScope,
): boolean {
  if (!isActiveProfile(profile)) {
    return false;
  }

  if (profile.role === "admin") {
    return true;
  }

  if (booking.requesterId === profile.id) {
    return true;
  }

  return (
    profile.role === "manager" && booking.room.managerId === profile.id
  );
}

export function canViewInstitutionAudit(profile: UserProfile): boolean {
  return isActiveProfile(profile) && profile.role === "admin";
}

export function canBindOrRevokeCredential(profile: UserProfile): boolean {
  return isActiveProfile(profile) && profile.role === "admin";
}

export function canEditRoomPolicy(
  profile: UserProfile,
  room: RoomAssignment,
): boolean {
  return canManageRoom(profile, room);
}

export function canViewAccessHistoryForRoom(
  profile: UserProfile,
  room: RoomAssignment,
): boolean {
  return canManageRoom(profile, room);
}

/**
 * Role is deliberately never accepted from a request payload. This helper is
 * for server code that has already loaded the authenticated profile.
 */
export function requireAdmin(profile: UserProfile): void {
  if (!isActiveProfile(profile) || profile.role !== "admin") {
    throw new Error("FORBIDDEN_ADMIN_ONLY");
  }
}
