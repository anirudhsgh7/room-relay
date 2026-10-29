"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/session";
import type {
  OutrankingRequest,
  SafeRequirement,
} from "@/lib/bookings/decisions";
import { decideBooking, type DecisionFieldErrors } from "@/lib/bookings/decisions";
import { cancelBookingAsStaff } from "@/lib/bookings/cancellation";
import { getDatabase } from "@/lib/db/client";

export interface DecisionFormState {
  error?: string;
  fieldErrors?: DecisionFieldErrors;
  requirements?: SafeRequirement[];
  outranking?: OutrankingRequest[];
  ruleLabel?: string;
}

export async function decideBookingAction(
  _previousState: DecisionFormState,
  formData: FormData,
): Promise<DecisionFormState> {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login?next=/app/manager/queue");
  }

  if (profile.role !== "manager" && profile.role !== "admin") {
    return { error: "You do not have permission to review requests." };
  }

  const bookingId =
    typeof formData.get("bookingId") === "string"
      ? String(formData.get("bookingId"))
      : "";
  const action = formData.get("decisionAction");
  const decisionReason =
    typeof formData.get("decisionReason") === "string"
      ? String(formData.get("decisionReason"))
      : "";
  const overrideReason =
    typeof formData.get("overrideReason") === "string"
      ? String(formData.get("overrideReason"))
      : "";
  const overrideRequirementIds = formData
    .getAll("overrideRequirementIds")
    .filter((value): value is string => typeof value === "string");
  const allocationExceptionReason =
    typeof formData.get("allocationExceptionReason") === "string"
      ? String(formData.get("allocationExceptionReason"))
      : "";

  if (action !== "approve" && action !== "reject") {
    return { error: "Choose whether to approve or reject the request." };
  }

  const result = await decideBooking(getDatabase(), profile, {
    bookingId,
    action,
    decisionReason,
    overrideRequirementIds,
    overrideReason,
    allocationExceptionReason,
  });

  if (result.ok) {
    revalidatePath("/app");
    revalidatePath("/app/manager/queue");
    revalidatePath(`/app/manager/requests/${result.receipt.bookingId}`);
    revalidatePath("/app/bookings");
    revalidatePath(`/app/bookings/${result.receipt.bookingId}`);
    const moved =
      result.receipt.waitlistedCount > 0
        ? `&waitlisted=${result.receipt.waitlistedCount}`
        : result.receipt.declinedCount > 0
          ? `&declined=${result.receipt.declinedCount}`
          : "";
    redirect(
      `/app/manager/requests/${result.receipt.bookingId}?decision=${result.receipt.status}${moved}`,
    );
  }

  switch (result.kind) {
    case "validation":
      return {
        error: result.message,
        fieldErrors: result.fieldErrors,
      };
    case "eligibility_required":
      return {
        error: result.message,
        requirements: result.requirements,
      };
    case "allocation_order":
      return {
        error: result.message,
        outranking: result.outranking,
        ruleLabel: result.ruleLabel,
      };
    case "already_decided":
    case "state_changed":
      return {
        error: `${result.message} Refresh to see the current status.`,
      };
    case "service_error":
      return {
        error: `${result.message} Reference: ${result.correlationId.slice(0, 8)}`,
      };
    case "forbidden":
    case "not_found":
    case "conflict":
    case "room_unavailable":
      return { error: result.message };
  }
}

export interface StaffCancelFormState {
  error?: string;
}

export async function cancelAsStaffAction(
  _previousState: StaffCancelFormState,
  formData: FormData,
): Promise<StaffCancelFormState> {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login?next=/app/manager/queue");
  }

  const field = (name: string) =>
    typeof formData.get(name) === "string" ? String(formData.get(name)) : "";
  const result = await cancelBookingAsStaff(getDatabase(), profile, {
    bookingId: field("bookingId"),
    reason: field("reason"),
  });

  if (result.ok) {
    revalidatePath("/app", "layout");
    redirect(
      `/app/manager/requests/${result.receipt.bookingId}?cancelled=1${
        result.receipt.promotedCount > 0 ? `&promoted=${result.receipt.promotedCount}` : ""
      }`,
    );
  }

  if (result.kind === "service_error") {
    return { error: `${result.message} Reference: ${result.correlationId.slice(0, 8)}` };
  }

  return { error: result.message };
}
