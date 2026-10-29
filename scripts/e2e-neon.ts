import { randomUUID } from "node:crypto";
import "./load-env";
import { getProfileById } from "@/lib/auth/service";
import { decideBooking } from "@/lib/bookings/decisions";
import { checkOutBooking } from "@/lib/bookings/checkout";
import { submitBookingRequest } from "@/lib/bookings/service";
import { resolveIncident } from "@/lib/incidents/service";
import { simulateAccessCheck } from "@/lib/access/service";
import { getDatabaseUrl } from "@/lib/config";
import { openDatabase } from "@/lib/db/client";
import { getRoomDetail } from "@/lib/rooms/queries";
import { nextWeekdayLocalDate } from "@/lib/time/campus-time";

function requiredProfile(
  profile: Awaited<ReturnType<typeof getProfileById>>,
  label: string,
) {
  if (!profile) {
    throw new Error(`Missing profile: ${label}`);
  }
  return profile;
}

async function main() {
  if (process.env.ROOMRELAY_E2E_ALLOW_MUTATION !== "1") {
    throw new Error(
      "Refusing to mutate a database. Set ROOMRELAY_E2E_ALLOW_MUTATION=1 and use a disposable Neon branch.",
    );
  }

  const db = openDatabase(getDatabaseUrl());

  try {
    const amelia = requiredProfile(
      await getProfileById(db, "usr_amelia_chen"),
      "Amelia Chen",
    );
    const marcus = requiredProfile(
      await getProfileById(db, "usr_marcus_webb"),
      "Marcus Webb",
    );
    const rowan = requiredProfile(
      await getProfileById(db, "usr_rowan_ellis"),
      "Rowan Ellis",
    );

    const room = await getRoomDetail(db, amelia, "SEM-02", null);

    if (!room) {
      throw new Error("Seminar Room 02 was not returned by getRoomDetail.");
    }

    const request = await submitBookingRequest(db, amelia, {
      roomCode: "SEM-02",
      startDate: nextWeekdayLocalDate(),
      startTime: "10:00",
      endTime: "11:00",
      purpose: "Neon end-to-end verification booking",
      groupName: "Verification Club",
      expectedAttendance: "6",
      acknowledgement: "on",
      idempotencyKey: randomUUID(),
    });

    if (!request.ok || request.receipt.status !== "pending") {
      throw new Error(`Booking request failed: ${JSON.stringify(request)}`);
    }

    const decision = await decideBooking(db, marcus, {
      bookingId: request.receipt.id,
      action: "approve",
      decisionReason:
        "Approved by the Neon end-to-end verification script after live checks.",
      overrideRequirementIds: [],
      overrideReason: "",
    });

    if (!decision.ok || decision.receipt.status !== "approved") {
      throw new Error(`Manager decision failed: ${JSON.stringify(decision)}`);
    }

    const access = await simulateAccessCheck(db, amelia, {
      credentialId: "cred_amelia_active",
      roomId: "room_classroom_14",
      eventNonce: randomUUID(),
    });

    if (!access.ok || access.response.decision !== "ALLOW") {
      throw new Error(`Access check failed: ${JSON.stringify(access)}`);
    }

    const checkout = await checkOutBooking(db, amelia, {
      bookingId: "booking_demo_active_classroom",
      conditionState: "left_as_found",
      notes: "Neon end-to-end verification: room left as found.",
    });

    if (!checkout.ok || checkout.receipt.status !== "completed") {
      throw new Error(`Check-out failed: ${JSON.stringify(checkout)}`);
    }

    const resolution = await resolveIncident(db, rowan, {
      incidentId: "incident_equipment_open",
      resolutionNote:
        "Neon end-to-end verification: final admin resolution recorded.",
    });

    if (!resolution.ok || resolution.receipt.status !== "resolved") {
      throw new Error(`Incident resolution failed: ${JSON.stringify(resolution)}`);
    }

    console.log(
      JSON.stringify(
        {
          room: room.code,
          requestId: request.receipt.id,
          requestStatus: request.receipt.status,
          decisionStatus: decision.receipt.status,
          accessDecision: access.response.decision,
          accessBookingStatus: access.response.bookingStatus,
          checkoutStatus: checkout.receipt.status,
          incidentStatus: resolution.receipt.status,
          bookingCompletedByResolution: resolution.receipt.bookingCompleted,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
