import { describe, expect, it } from "vitest";
import type { UserProfile } from "@/lib/auth/service";
import {
  canApproveOrRejectBooking,
  canBindOrRevokeCredential,
  canEditRoomPolicy,
  canManageRoom,
  canViewAccessHistoryForRoom,
  canViewBookingDetails,
  canViewInstitutionAudit,
  isActiveProfile,
  requireAdmin,
} from "@/lib/authorization";

function profile(
  id: string,
  role: UserProfile["role"],
  status: UserProfile["status"] = "active",
): UserProfile {
  return {
    id,
    email: `${id}@roomrelay.demo`,
    displayName: id,
    role,
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const student = profile("student", "student");
const manager = profile("manager", "manager");
const otherManager = profile("other-manager", "manager");
const admin = profile("admin", "admin");
const suspendedAdmin = profile("suspended-admin", "admin", "suspended");

const managedRoom = { id: "room-a", managerId: "manager" };
const otherRoom = { id: "room-b", managerId: "other-manager" };

describe("authorization matrix", () => {
  it("allows only an assigned manager or admin to manage a room", async () => {
    expect(canManageRoom(manager, managedRoom)).toBe(true);
    expect(canManageRoom(manager, otherRoom)).toBe(false);
    expect(canManageRoom(otherManager, otherRoom)).toBe(true);
    expect(canManageRoom(student, managedRoom)).toBe(false);
    expect(canManageRoom(admin, otherRoom)).toBe(true);
  });

  it("rejects a suspended profile even if the stored role is admin", async () => {
    expect(isActiveProfile(suspendedAdmin)).toBe(false);
    expect(canManageRoom(suspendedAdmin, managedRoom)).toBe(false);
    expect(canViewInstitutionAudit(suspendedAdmin)).toBe(false);
    expect(() => requireAdmin(suspendedAdmin)).toThrow("FORBIDDEN_ADMIN_ONLY");
  });

  it("scopes approval and policy actions to room ownership", async () => {
    expect(canApproveOrRejectBooking(manager, managedRoom)).toBe(true);
    expect(canApproveOrRejectBooking(manager, otherRoom)).toBe(false);
    expect(canEditRoomPolicy(manager, managedRoom)).toBe(true);
    expect(canEditRoomPolicy(student, managedRoom)).toBe(false);
    expect(canViewAccessHistoryForRoom(manager, managedRoom)).toBe(true);
    expect(canViewAccessHistoryForRoom(manager, otherRoom)).toBe(false);
  });

  it("lets requesters see their own booking, managers see assigned rooms, and admins see all", async () => {
    const ownBooking = {
      requesterId: "student",
      room: otherRoom,
    };
    const managedBooking = {
      requesterId: "someone-else",
      room: managedRoom,
    };

    expect(canViewBookingDetails(student, ownBooking)).toBe(true);
    expect(canViewBookingDetails(manager, ownBooking)).toBe(false);
    expect(canViewBookingDetails(manager, managedBooking)).toBe(true);
    expect(canViewBookingDetails(otherManager, managedBooking)).toBe(false);
    expect(canViewBookingDetails(admin, managedBooking)).toBe(true);
  });

  it("restricts credential administration and institution audit to admin", async () => {
    expect(canBindOrRevokeCredential(admin)).toBe(true);
    expect(canBindOrRevokeCredential(manager)).toBe(false);
    expect(canBindOrRevokeCredential(student)).toBe(false);

    expect(canViewInstitutionAudit(admin)).toBe(true);
    expect(canViewInstitutionAudit(manager)).toBe(false);
    expect(canViewInstitutionAudit(student)).toBe(false);

    expect(() => requireAdmin(admin)).not.toThrow();
    expect(() => requireAdmin(manager)).toThrow("FORBIDDEN_ADMIN_ONLY");
  });
});
