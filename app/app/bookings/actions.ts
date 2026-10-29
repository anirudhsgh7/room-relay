"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/session";
import { cancelOwnBooking } from "@/lib/bookings/cancellation";
import { checkOutBooking } from "@/lib/bookings/checkout";
import type { CheckoutFieldErrors } from "@/lib/bookings/checkout";
import { getDatabase } from "@/lib/db/client";

export interface CancellationFormState {
  error?: string;
  fieldErrors?: { reason?: string };
}

export interface CheckoutFormState {
  error?: string;
  fieldErrors?: CheckoutFieldErrors;
}

export async function cancelBookingAction(
  _previousState: CancellationFormState,
  formData: FormData,
): Promise<CancellationFormState> {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login?next=/app/bookings");
  }

  const bookingId =
    typeof formData.get("bookingId") === "string"
      ? String(formData.get("bookingId"))
      : "";
  const reason =
    typeof formData.get("cancellationReason") === "string"
      ? String(formData.get("cancellationReason"))
      : "";

  const result = await cancelOwnBooking(getDatabase(), profile, {
    bookingId,
    reason,
  });

  if (result.ok) {
    revalidatePath("/app", "layout");
    redirect(`/app/bookings/${result.receipt.bookingId}?cancelled=1`);
  }

  switch (result.kind) {
    case "validation":
      return { error: result.message, fieldErrors: result.fieldErrors };
    case "not_cancellable":
    case "state_changed":
      return {
        error: result.message,
      };
    case "service_error":
      return {
        error: `${result.message} Reference: ${result.correlationId.slice(0, 8)}`,
      };
    case "forbidden":
    case "not_found":
      return { error: result.message };
  }
}

export async function checkOutBookingAction(
  _previousState: CheckoutFormState,
  formData: FormData,
): Promise<CheckoutFormState> {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login?next=/app/bookings");
  }

  const field = (name: string) =>
    typeof formData.get(name) === "string" ? String(formData.get(name)) : "";
  const result = await checkOutBooking(getDatabase(), profile, {
    bookingId: field("bookingId"),
    conditionState: field("conditionState") as
      | "left_as_found"
      | "issue_found",
    notes: field("notes"),
    incidentCategory: field("incidentCategory"),
    issueDescription: field("issueDescription"),
  });

  if (result.ok) {
    revalidatePath("/app/bookings");
    revalidatePath(`/app/bookings/${result.receipt.bookingId}`);
    revalidatePath("/app/incidents");
    redirect(`/app/bookings/${result.receipt.bookingId}?checkedout=1`);
  }

  switch (result.kind) {
    case "validation":
      return { error: result.message, fieldErrors: result.fieldErrors };
    case "not_checkable":
      return {
        error: `${result.message} Current status: ${result.currentStatus}.`,
      };
    case "service_error":
      return {
        error: `${result.message} Reference: ${result.correlationId.slice(0, 8)}`,
      };
    case "forbidden":
    case "not_found":
      return { error: result.message };
  }
}
