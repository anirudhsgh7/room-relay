"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/session";
import {
  resolveIncident,
  reviewIncident,
} from "@/lib/incidents/service";
import { getDatabase } from "@/lib/db/client";

export interface IncidentActionState {
  error?: string;
  fieldErrors?: { note?: string };
}

export async function reviewIncidentAction(
  _previousState: IncidentActionState,
  formData: FormData,
): Promise<IncidentActionState> {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login?next=/app/incidents");
  }

  if (profile.role !== "manager" && profile.role !== "admin") {
    return { error: "You do not have permission to review incidents." };
  }

  const incidentId =
    typeof formData.get("incidentId") === "string"
      ? String(formData.get("incidentId"))
      : "";
  const note =
    typeof formData.get("note") === "string" ? String(formData.get("note")) : "";
  const result = reviewIncident(getDatabase(), profile, {
    incidentId,
    note,
  });

  if (result.ok) {
    revalidatePath("/app/incidents");
    revalidatePath(`/app/incidents/${result.receipt.incidentId}`);
    redirect(`/app/incidents/${result.receipt.incidentId}?updated=reviewing`);
  }

  switch (result.kind) {
    case "validation":
      return { error: result.message, fieldErrors: result.fieldErrors };
    case "not_available":
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

export async function resolveIncidentAction(
  _previousState: IncidentActionState,
  formData: FormData,
): Promise<IncidentActionState> {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login?next=/app/incidents");
  }

  if (profile.role !== "admin") {
    return { error: "Only an administrator can finalize incident resolution." };
  }

  const incidentId =
    typeof formData.get("incidentId") === "string"
      ? String(formData.get("incidentId"))
      : "";
  const resolutionNote =
    typeof formData.get("resolutionNote") === "string"
      ? String(formData.get("resolutionNote"))
      : "";
  const result = resolveIncident(getDatabase(), profile, {
    incidentId,
    resolutionNote,
  });

  if (result.ok) {
    revalidatePath("/app/incidents");
    revalidatePath(`/app/incidents/${result.receipt.incidentId}`);
    revalidatePath("/app/bookings");
    redirect(`/app/incidents/${result.receipt.incidentId}?updated=resolved`);
  }

  switch (result.kind) {
    case "validation":
      return { error: result.message, fieldErrors: result.fieldErrors };
    case "not_available":
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
