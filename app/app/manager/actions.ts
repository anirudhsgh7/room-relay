"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/session";
import type { SafeRequirement } from "@/lib/bookings/decisions";
import { decideBooking, type DecisionFieldErrors } from "@/lib/bookings/decisions";
import { getDatabase } from "@/lib/db/client";

export interface DecisionFormState {
  error?: string;
  fieldErrors?: DecisionFieldErrors;
  requirements?: SafeRequirement[];
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

  if (action !== "approve" && action !== "reject") {
    return { error: "Choose whether to approve or reject the request." };
  }

  const result = decideBooking(getDatabase(), profile, {
    bookingId,
    action,
    decisionReason,
    overrideRequirementIds,
    overrideReason,
  });

  if (result.ok) {
    revalidatePath("/app/manager/queue");
    revalidatePath(`/app/manager/requests/${result.receipt.bookingId}`);
    revalidatePath("/app/bookings");
    revalidatePath(`/app/bookings/${result.receipt.bookingId}`);
    redirect(
      `/app/manager/requests/${result.receipt.bookingId}?decision=${result.receipt.status}`,
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
    case "already_decided":
    case "state_changed":
      return {
        error: `${result.message} Current status: ${result.currentStatus}.`,
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
