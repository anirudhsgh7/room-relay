import { createHash, randomUUID } from "node:crypto";
import { getProfileById, type UserProfile } from "@/lib/auth/service";
import type { RoomRelayDatabase } from "@/lib/db/client";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  ACCESS_REASON_MESSAGES,
  type AccessCheckResponse,
  type AccessReasonCode,
} from "@/lib/access/types";
import {
  accessCheckSchema,
  type AccessCheckInput,
} from "@/lib/access/validation";

const RATE_LIMIT = {
  limit: 20,
  windowMs: 60_000,
};

const SIMULATOR_READER_ID = "reader-simulator-01";

interface RoomRow {
  id: string;
  code: string;
  name: string;
  status: string;
}

interface CredentialRow {
  id: string;
  user_id: string;
  credential_ref: string;
  credential_type: "nfc_uid" | "demo_token";
  active: number;
  revoked_at: string | null;
}

interface BookingRow {
  id: string;
  status: string;
  start_at: string;
  end_at: string;
}

interface ExistingEventRow {
  id: string;
  actor_id: string | null;
  booking_id: string | null;
  result: "allowed" | "denied";
  reason_code: string;
  occurred_at: string;
  request_hash: string | null;
}

export type AccessServiceResult =
  | {
      ok: true;
      httpStatus: 200 | 429;
      response: AccessCheckResponse;
    }
  | {
      ok: false;
      httpStatus: 400 | 403 | 409 | 503;
      error: string;
      reasonCode?: AccessReasonCode;
    };

function requestHash(
  actorId: string,
  credentialId: string,
  roomId: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ actorId, credentialId, roomId }))
    .digest("hex");
}

function messageFor(reason: string): string {
  return (
    ACCESS_REASON_MESSAGES[reason] ??
    "The access check could not be completed."
  );
}

function responseFor(input: {
  result: "allowed" | "denied";
  reasonCode: string;
  eventId: string | null;
  occurredAt: string;
  bookingId?: string | null;
  bookingStatus?: string | null;
  replayed?: boolean;
}): AccessCheckResponse {
  return {
    decision: input.result === "allowed" ? "ALLOW" : "DENY",
    reasonCode: input.reasonCode as AccessReasonCode,
    message: messageFor(input.reasonCode),
    source: "SIMULATED",
    replayed: input.replayed ?? false,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
    bookingId: input.bookingId ?? null,
    bookingStatus: input.bookingStatus ?? null,
  };
}

async function findExistingEvent(
  db: RoomRelayDatabase,
  nonce: string,
): Promise<ExistingEventRow | null> {
  const row = (await db
    .prepare(
      `SELECT id, actor_id, booking_id, result, reason_code, occurred_at,
              request_hash
       FROM access_events
       WHERE correlation_id = ?`,
    )
    .get(nonce)) as ExistingEventRow | undefined;

  return row ?? null;
}

async function insertEventAndAudit(
  db: RoomRelayDatabase,
  input: {
    actor: UserProfile;
    credentialId: string | null;
    attemptedCredentialRef: string;
    room: RoomRow;
    bookingId: string | null;
    result: "allowed" | "denied";
    reasonCode: AccessReasonCode;
    occurredAt: string;
    correlationId: string;
    requestHash: string;
  },
): Promise<string> {
  const eventId = `access_${randomUUID()}`;

  await db.prepare(
    `INSERT INTO access_events (
       id, credential_id, attempted_credential_ref, room_id, occurred_at,
       result, reason_code, source, correlation_id, created_at,
       actor_id, booking_id, reader_id, request_hash
     ) VALUES (
       @id, @credential_id, @attempted_credential_ref, @room_id, @occurred_at,
       @result, @reason_code, 'simulator', @correlation_id, @created_at,
       @actor_id, @booking_id, @reader_id, @request_hash
     )`,
  ).run({
    id: eventId,
    credential_id: input.credentialId,
    attempted_credential_ref: input.attemptedCredentialRef,
    room_id: input.room.id,
    occurred_at: input.occurredAt,
    result: input.result,
    reason_code: input.reasonCode,
    correlation_id: input.correlationId,
    created_at: input.occurredAt,
    actor_id: input.actor.id,
    booking_id: input.bookingId,
    reader_id: SIMULATOR_READER_ID,
    request_hash: input.requestHash,
  });

  await db.prepare(
    `INSERT INTO audit_events (
       id, actor_id, action, entity_type, entity_id, occurred_at,
       summary, correlation_id, metadata_json
     ) VALUES (
       @id, @actor_id, @action, 'access_event', @entity_id, @occurred_at,
       @summary, @correlation_id, @metadata_json
     )`,
  ).run({
    id: `audit_${randomUUID()}`,
    actor_id: input.actor.id,
    action:
      input.result === "allowed" ? "access.allowed" : "access.denied",
    entity_id: eventId,
    occurred_at: input.occurredAt,
    summary: `Simulated access ${input.result} for ${input.room.name} (${input.reasonCode}).`,
    correlation_id: input.correlationId,
    metadata_json: JSON.stringify({
      reasonCode: input.reasonCode,
      roomCode: input.room.code,
      bookingId: input.bookingId,
      source: "simulator",
    }),
  });

  return eventId;
}

/**
 * Simulated access check.
 *
 * The browser supplies only a credential row ID, room ID, and nonce. The actor,
 * server time, decision, reason, booking state, and event fields are derived
 * from trusted state. This service is the software equivalent of the future
 * access-policy boundary; it does not actuate a door.
 */
export async function simulateAccessCheck(
  db: RoomRelayDatabase,
  actor: UserProfile,
  input: AccessCheckInput,
): Promise<AccessServiceResult> {
  const parsed = accessCheckSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      httpStatus: 400,
      error:
        parsed.error.issues[0]?.message ??
        "The access-check request is invalid.",
    };
  }

  const hash = requestHash(
    actor.id,
    parsed.data.credentialId,
    parsed.data.roomId,
  );
  const correlationId = parsed.data.eventNonce;

  try {
    const execute = db.transaction(async (): Promise<AccessServiceResult> => {
      const freshActor = await getProfileById(db, actor.id);

      if (!freshActor) {
        return {
          ok: false,
          httpStatus: 403,
          error: "Your account is not active for access checks.",
          reasonCode: "ACCOUNT_INACTIVE",
        };
      }

      const existing = await findExistingEvent(db, correlationId);

      if (existing) {
        if (
          existing.actor_id !== freshActor.id ||
          existing.request_hash !== hash
        ) {
          return {
            ok: false,
            httpStatus: 409,
            error: messageFor("REPLAYED_ATTEMPT"),
            reasonCode: "REPLAYED_ATTEMPT",
          };
        }

        return {
          ok: true,
          httpStatus: 200,
          response: responseFor({
            result: existing.result,
            reasonCode: existing.reason_code,
            eventId: existing.id,
            occurredAt: existing.occurred_at,
            bookingId: existing.booking_id,
            replayed: true,
          }),
        };
      }

      const now = new Date();
      const occurredAt = now.toISOString();

      const room = (await db
        .prepare(
          `SELECT id, code, name, status
           FROM rooms
           WHERE id = ?`,
        )
        .get(parsed.data.roomId)) as RoomRow | undefined;

      if (!room) {
        return {
          ok: true,
          httpStatus: 200,
          response: responseFor({
            result: "denied",
            reasonCode: "ROOM_NOT_FOUND",
            eventId: null,
            occurredAt,
          }),
        };
      }

      const rate = consumeRateLimit(`access-check:${freshActor.id}`, RATE_LIMIT);

      if (!rate.allowed) {
        const eventId = await insertEventAndAudit(db, {
          actor: freshActor,
          credentialId: null,
          attemptedCredentialRef: "rate-limited-simulator-attempt",
          room,
          bookingId: null,
          result: "denied",
          reasonCode: "RATE_LIMITED",
          occurredAt,
          correlationId,
          requestHash: hash,
        });

        return {
          ok: true,
          httpStatus: 429,
          response: responseFor({
            result: "denied",
            reasonCode: "RATE_LIMITED",
            eventId,
            occurredAt,
          }),
        };
      }

      const credential = (await db
        .prepare(
          `SELECT id, user_id, credential_ref, credential_type, active, revoked_at
           FROM credentials
           WHERE id = ?`,
        )
        .get(parsed.data.credentialId)) as CredentialRow | undefined;

      if (!credential) {
        const eventId = await insertEventAndAudit(db, {
          actor: freshActor,
          credentialId: null,
          attemptedCredentialRef: "unmapped-simulator-credential",
          room,
          bookingId: null,
          result: "denied",
          reasonCode: "UNKNOWN_CREDENTIAL",
          occurredAt,
          correlationId,
          requestHash: hash,
        });

        return {
          ok: true,
          httpStatus: 200,
          response: responseFor({
            result: "denied",
            reasonCode: "UNKNOWN_CREDENTIAL",
            eventId,
            occurredAt,
          }),
        };
      }

      if (credential.user_id !== freshActor.id) {
        const eventId = await insertEventAndAudit(db, {
          actor: freshActor,
          credentialId: null,
          attemptedCredentialRef: "unowned-simulator-credential",
          room,
          bookingId: null,
          result: "denied",
          reasonCode: "CREDENTIAL_NOT_OWNED",
          occurredAt,
          correlationId,
          requestHash: hash,
        });

        return {
          ok: true,
          httpStatus: 200,
          response: responseFor({
            result: "denied",
            reasonCode: "CREDENTIAL_NOT_OWNED",
            eventId,
            occurredAt,
          }),
        };
      }

      if (credential.active !== 1) {
        const eventId = await insertEventAndAudit(db, {
          actor: freshActor,
          credentialId: credential.id,
          attemptedCredentialRef: credential.credential_ref,
          room,
          bookingId: null,
          result: "denied",
          reasonCode: "CREDENTIAL_REVOKED",
          occurredAt,
          correlationId,
          requestHash: hash,
        });

        return {
          ok: true,
          httpStatus: 200,
          response: responseFor({
            result: "denied",
            reasonCode: "CREDENTIAL_REVOKED",
            eventId,
            occurredAt,
          }),
        };
      }

      if (room.status !== "active") {
        const eventId = await insertEventAndAudit(db, {
          actor: freshActor,
          credentialId: credential.id,
          attemptedCredentialRef: credential.credential_ref,
          room,
          bookingId: null,
          result: "denied",
          reasonCode: "ROOM_INACTIVE",
          occurredAt,
          correlationId,
          requestHash: hash,
        });

        return {
          ok: true,
          httpStatus: 200,
          response: responseFor({
            result: "denied",
            reasonCode: "ROOM_INACTIVE",
            eventId,
            occurredAt,
          }),
        };
      }

      const bookings = (await db
        .prepare(
          `SELECT id, status, start_at, end_at
           FROM bookings
           WHERE requester_id = ?
             AND room_id = ?
           ORDER BY start_at DESC`,
        )
        .all([freshActor.id, room.id])) as BookingRow[];

      const activeBooking = bookings.find(
        (booking) =>
          (booking.status === "approved" || booking.status === "checked_in") &&
          Date.parse(booking.start_at) <= now.getTime() &&
          now.getTime() < Date.parse(booking.end_at),
      );

      if (!activeBooking) {
        const approvedOrCheckedIn = bookings.find(
          (booking) =>
            booking.status === "approved" || booking.status === "checked_in",
        );
        const nonApproved = bookings.find((booking) =>
          ["pending", "waitlisted", "draft"].includes(booking.status),
        );
        const reasonCode: AccessReasonCode = approvedOrCheckedIn
          ? "OUTSIDE_BOOKING_WINDOW"
          : nonApproved
            ? "BOOKING_NOT_APPROVED"
            : "NO_APPROVED_BOOKING";
        const bookingId =
          approvedOrCheckedIn?.id ?? nonApproved?.id ?? null;
        const eventId = await insertEventAndAudit(db, {
          actor: freshActor,
          credentialId: credential.id,
          attemptedCredentialRef: credential.credential_ref,
          room,
          bookingId,
          result: "denied",
          reasonCode,
          occurredAt,
          correlationId,
          requestHash: hash,
        });

        return {
          ok: true,
          httpStatus: 200,
          response: responseFor({
            result: "denied",
            reasonCode,
            eventId,
            occurredAt,
            bookingId,
            bookingStatus:
              approvedOrCheckedIn?.status ?? nonApproved?.status ?? null,
          }),
        };
      }

      let bookingStatus: string = activeBooking.status;

      if (activeBooking.status === "approved") {
        const checkIn = await db
          .prepare(
            `UPDATE bookings
             SET status = 'checked_in', updated_at = ?
             WHERE id = ? AND status = 'approved'`,
          )
          .run([occurredAt, activeBooking.id]);

        if (checkIn.changes !== 1) {
          return {
            ok: false,
            httpStatus: 503,
            error: "The check-in could not be recorded. No access was granted.",
            reasonCode: "SERVICE_UNAVAILABLE",
          };
        }

        bookingStatus = "checked_in";
      }

      const eventId = await insertEventAndAudit(db, {
        actor: freshActor,
        credentialId: credential.id,
        attemptedCredentialRef: credential.credential_ref,
        room,
        bookingId: activeBooking.id,
        result: "allowed",
        reasonCode: "ACCESS_ALLOWED",
        occurredAt,
        correlationId,
        requestHash: hash,
      });

      return {
        ok: true,
        httpStatus: 200,
        response: responseFor({
          result: "allowed",
          reasonCode: "ACCESS_ALLOWED",
          eventId,
          occurredAt,
          bookingId: activeBooking.id,
          bookingStatus,
        }),
      };
    });

    return await execute.immediate();
  } catch (error) {
    console.error(
      "Access check failed:",
      error instanceof Error ? error.message : "unknown error",
    );

    return {
      ok: false,
      httpStatus: 503,
      error: "Access service is unavailable. No access was granted.",
      reasonCode: "SERVICE_UNAVAILABLE",
    };
  }
}
