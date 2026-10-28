"use server";

import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/session";
import { submitBookingRequest } from "@/lib/bookings/service";
import type { FieldErrors } from "@/lib/bookings/validation";
import type { SafeAlternative } from "@/lib/bookings/types";
import { getDatabase } from "@/lib/db/client";

export interface BookingFormState {
  error?: string;
  fieldErrors?: FieldErrors;
  alternatives?: SafeAlternative[];
  duplicateId?: string;
}

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function submitBookingRequestAction(
  _previousState: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login?next=/app/rooms");
  }

  if (profile.role !== "student") {
    return {
      error: "Only student and club-lead accounts can submit room requests.",
    };
  }

  const result = submitBookingRequest(getDatabase(), profile, {
    roomCode: formString(formData, "roomCode"),
    startDate: formString(formData, "startDate"),
    startTime: formString(formData, "startTime"),
    endTime: formString(formData, "endTime"),
    purpose: formString(formData, "purpose"),
    groupName: formString(formData, "groupName"),
    expectedAttendance: formString(formData, "expectedAttendance"),
    acknowledgement: formString(formData, "acknowledgement"),
    idempotencyKey: formString(formData, "idempotencyKey"),
  });

  if (result.ok) {
    redirect(`/app/bookings/${result.receipt.id}?created=1`);
  }

  switch (result.kind) {
    case "validation":
      return {
        error: result.message,
        fieldErrors: result.fieldErrors,
      };
    case "conflict":
    case "outside_hours":
      return {
        error: result.message,
        alternatives: result.alternatives,
      };
    case "duplicate":
      return {
        error: result.message,
        duplicateId: result.bookingId,
      };
    case "rate_limited":
      return {
        error: result.retryAfterSeconds
          ? `${result.message} Try again in ${Math.ceil(
              result.retryAfterSeconds / 60,
            )} minute(s).`
          : result.message,
      };
    case "service_error":
      return {
        error: `${result.message} Reference: ${result.correlationId.slice(0, 8)}`,
      };
    case "unavailable":
    case "forbidden":
    case "idempotency_mismatch":
      return { error: result.message };
  }
}
