"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addBlackout,
  createRoom,
  removeBlackout,
  updateRoomDetails,
  updateRoomHours,
  updateRoomPolicy,
  type AdminResult,
  type ImpactedBooking,
  type WeekdayHours,
} from "@/lib/admin/rooms";
import { getCurrentProfile } from "@/lib/auth/session";
import { getDatabase } from "@/lib/db/client";
import type { AllocationRule } from "@/lib/rooms/policy";

export interface AdminFormState {
  /** Increments on each successful save so forms can show a fresh message. */
  savedAt?: number;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  confirm?: {
    message: string;
    impact: ImpactedBooking[];
    inUse: ImpactedBooking[];
  };
  warnings?: { title: string; items: ImpactedBooking[] };
  values?: Record<string, string>;
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function checked(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

async function requireStaff() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login?next=/app/admin/rooms");
  }

  return profile;
}

function failure(
  result: Exclude<AdminResult<object>, { ok: true }>,
  values: Record<string, string>,
): AdminFormState {
  switch (result.kind) {
    case "validation":
      return { error: result.message, fieldErrors: result.fieldErrors, values };
    case "needs_confirmation":
      return {
        confirm: { message: result.message, impact: result.impact, inUse: result.inUse },
        values,
      };
    default:
      return { error: result.message, values };
  }
}

function refresh(roomId: string) {
  revalidatePath("/app", "layout");
  revalidatePath(`/app/admin/rooms/${roomId}`);
}

const DETAIL_FIELDS = [
  "code",
  "name",
  "building",
  "location",
  "capacity",
  "facilities",
  "policySummary",
  "managerId",
  "status",
] as const;

function detailValues(formData: FormData): Record<string, string> {
  return Object.fromEntries(DETAIL_FIELDS.map((field) => [field, text(formData, field)]));
}

export async function createRoomAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const profile = await requireStaff();
  const values = detailValues(formData);
  const result = createRoom(getDatabase(), profile, {
    code: values.code,
    name: values.name!,
    building: values.building!,
    location: values.location!,
    capacity: values.capacity!,
    facilities: values.facilities!,
    policySummary: values.policySummary!,
    managerId: values.managerId!,
  });

  if (!result.ok) {
    return failure(result, values);
  }

  refresh(result.roomId);
  redirect(`/app/admin/rooms/${result.roomId}?created=1`);
}

export async function updateDetailsAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const profile = await requireStaff();
  const roomId = text(formData, "roomId");
  const values = detailValues(formData);
  const result = updateRoomDetails(getDatabase(), profile, roomId, {
    name: values.name!,
    building: values.building!,
    location: values.location!,
    capacity: values.capacity!,
    facilities: values.facilities!,
    policySummary: values.policySummary!,
    managerId: values.managerId!,
    status: values.status!,
    confirmImpact: checked(formData, "confirmImpact"),
  });

  if (!result.ok) {
    return failure(result, values);
  }

  refresh(roomId);
  return {
    savedAt: Date.now(),
    message:
      result.cancelledCount > 0
        ? `Saved. ${result.cancelledCount} upcoming ${
            result.cancelledCount === 1 ? "booking was" : "bookings were"
          } cancelled and each person was told why.`
        : "Room details saved.",
    warnings:
      result.overCapacity.length > 0
        ? {
            title: "These upcoming bookings expect more people than the new seat count. They have not been changed.",
            items: result.overCapacity,
          }
        : undefined,
    values,
  };
}

export async function updateHoursAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const profile = await requireStaff();
  const roomId = text(formData, "roomId");
  const days: WeekdayHours[] = [1, 2, 3, 4, 5, 6, 0].map((weekday) => ({
    weekday,
    open: checked(formData, `open_${weekday}`),
    opensAt: text(formData, `opens_${weekday}`),
    closesAt: text(formData, `closes_${weekday}`),
  }));
  const values = Object.fromEntries(
    days.flatMap((day) => [
      [`open_${day.weekday}`, day.open ? "on" : ""],
      [`opens_${day.weekday}`, day.opensAt],
      [`closes_${day.weekday}`, day.closesAt],
    ]),
  );
  const result = updateRoomHours(getDatabase(), profile, roomId, days);

  if (!result.ok) {
    return failure(result, values);
  }

  refresh(roomId);
  return {
    savedAt: Date.now(),
    message: "Opening hours saved. New requests use them straight away.",
    warnings:
      result.outsideHours.length > 0
        ? {
            title: "These upcoming bookings and requests now fall outside the opening hours. Existing approvals stand; pending requests can no longer be approved.",
            items: result.outsideHours,
          }
        : undefined,
    values,
  };
}

const POLICY_FIELDS = [
  "slotIntervalMinutes",
  "minimumNoticeMinutes",
  "maximumDurationMinutes",
  "bufferMinutes",
  "maxAdvanceDays",
  "maxActivePerRequester",
  "allocationRule",
] as const;

export async function updatePolicyAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const profile = await requireStaff();
  const roomId = text(formData, "roomId");
  const values: Record<string, string> = {
    ...Object.fromEntries(POLICY_FIELDS.map((field) => [field, text(formData, field)])),
    requestsEnabled: checked(formData, "requestsEnabled") ? "on" : "",
    waitlistEnabled: checked(formData, "waitlistEnabled") ? "on" : "",
  };
  const result = updateRoomPolicy(getDatabase(), profile, roomId, {
    requestsEnabled: values.requestsEnabled === "on",
    waitlistEnabled: values.waitlistEnabled === "on",
    slotIntervalMinutes: values.slotIntervalMinutes!,
    minimumNoticeMinutes: values.minimumNoticeMinutes!,
    maximumDurationMinutes: values.maximumDurationMinutes!,
    bufferMinutes: values.bufferMinutes!,
    maxAdvanceDays: values.maxAdvanceDays!,
    maxActivePerRequester: values.maxActivePerRequester!,
    allocationRule: values.allocationRule as AllocationRule,
  });

  if (!result.ok) {
    return failure(result, values);
  }

  refresh(roomId);
  return { savedAt: Date.now(), message: "Booking rules saved and published on the room page.", values };
}

export async function addBlackoutAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const profile = await requireStaff();
  const roomId = text(formData, "roomId");
  const values = {
    startDate: text(formData, "startDate"),
    endDate: text(formData, "endDate"),
    startTime: text(formData, "startTime"),
    endTime: text(formData, "endTime"),
    allDay: checked(formData, "allDay") ? "on" : "",
    reason: text(formData, "reason"),
  };
  const result = addBlackout(getDatabase(), profile, roomId, {
    startDate: values.startDate,
    endDate: values.endDate || values.startDate,
    allDay: values.allDay === "on",
    startTime: values.startTime,
    endTime: values.endTime,
    reason: values.reason,
    confirmImpact: checked(formData, "confirmImpact"),
  });

  if (!result.ok) {
    return failure(result, values);
  }

  refresh(roomId);
  return {
    savedAt: Date.now(),
    message:
      result.cancelledCount > 0
        ? `Closure added. ${result.cancelledCount} ${
            result.cancelledCount === 1 ? "booking was" : "bookings were"
          } cancelled and each person was told why.`
        : "Closure added. The room can't be requested during it.",
  };
}

export async function removeBlackoutAction(formData: FormData): Promise<void> {
  const profile = await requireStaff();
  const roomId = text(formData, "roomId");
  removeBlackout(getDatabase(), profile, roomId, text(formData, "blackoutId"));
  refresh(roomId);
  redirect(`/app/admin/rooms/${roomId}?reopened=1#closures`);
}
