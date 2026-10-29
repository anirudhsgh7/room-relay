import { createHash, randomUUID } from "node:crypto";
import { getProfileById, type UserProfile } from "@/lib/auth/service";
import type { BookingResult, EligibilityWarning, SafeAlternative } from "@/lib/bookings/types";
import { getCampusTimezone } from "@/lib/config";
import {
  bookingRequestSubmissionSchema,
  validationFieldErrors,
  type BookingRequestSubmission,
} from "@/lib/bookings/validation";
import type { RoomRelayDatabase } from "@/lib/db/client";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  checkRoomSchedule,
  findPendingDuplicate,
  getAllBlockingBookings,
  getBlockingBookings,
  intervalsConflict,
} from "@/lib/rooms/availability";
import {
  findOverlappingBlackouts,
  loadActiveBlackoutWindows,
} from "@/lib/rooms/blackouts";
import { recordAudit } from "@/lib/audit";
import {
  activeRoomManagerId,
  createNotification,
  reviewerLink,
} from "@/lib/notifications/service";
import { getRoomDetail } from "@/lib/rooms/queries";
import type { RoomDetail } from "@/lib/rooms/types";
import type { BookingStatus } from "@/lib/domain";
import {
  addDaysToLocalDate,
  formatCampusDate,
  formatCampusDateTime,
  formatCampusTimeRange,
  localDateWeekday,
  minutesToTime,
  parseCampusInterval,
  type CampusInterval,
} from "@/lib/time/campus-time";

interface ExistingBookingRow {
  id: string;
  room_code: string;
  room_name: string;
  building: string;
  location: string;
  purpose: string;
  group_name: string | null;
  expected_attendance: number;
  start_at: string;
  end_at: string;
  status: BookingStatus;
  decision_reason: string | null;
  created_at: string;
  request_payload_hash: string | null;
  eligibility_snapshot_json: string | null;
}

interface EligibilitySnapshotItem {
  requirementId: string;
  description: string;
  required: boolean;
  status: "verified" | "unverified" | "expired" | null;
}

const RATE_LIMIT = {
  limit: 10,
  windowMs: 10 * 60 * 1000,
};

function bookingReceiptFromRow(
  row: ExistingBookingRow,
): Extract<BookingResult, { ok: true }> {
  const warnings = eligibilityWarnings(row.eligibility_snapshot_json);

  return {
    ok: true,
    kind: "existing",
    receipt: {
      id: row.id,
      roomCode: row.room_code,
      roomName: row.room_name,
      building: row.building,
      location: row.location,
      purpose: row.purpose,
      groupName: row.group_name,
      expectedAttendance: row.expected_attendance,
      startAt: row.start_at,
      endAt: row.end_at,
      timeZone: getCampusTimezone(),
      status: row.status,
      decisionReason: row.decision_reason,
      createdAt: row.created_at,
      eligibilityWarnings: warnings,
    },
    eligibilityWarnings: warnings,
  };
}

function eligibilityWarnings(value: string | null): EligibilityWarning[] {
  if (!value) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      if (
        typeof item !== "object" ||
        item === null ||
        !("requirementId" in item) ||
        !("description" in item) ||
        !("required" in item) ||
        !("status" in item)
      ) {
        return [];
      }

      const candidate = item as EligibilitySnapshotItem;

      if (!candidate.required || candidate.status === "verified") {
        return [];
      }

      return [
        {
          requirementId: candidate.requirementId,
          description: candidate.description,
        },
      ];
    });
  } catch {
    return [];
  }
}

function findExistingByKey(
  db: RoomRelayDatabase,
  requesterId: string,
  submissionKey: string,
): ExistingBookingRow | null {
  const row = db
    .prepare(
      `SELECT
         b.id, b.purpose, b.group_name, b.expected_attendance, b.start_at,
         b.end_at, b.status, b.decision_reason, b.created_at,
         b.request_payload_hash, b.eligibility_snapshot_json,
         r.code AS room_code, r.name AS room_name, r.building, r.location
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       WHERE b.requester_id = ?
         AND b.submission_key = ?`,
    )
    .get(requesterId, submissionKey) as ExistingBookingRow | undefined;

  return row ?? null;
}

function payloadHash(
  input: ReturnType<typeof bookingRequestSubmissionSchema.parse>,
  interval: CampusInterval,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        roomCode: input.roomCode.toUpperCase(),
        startAt: interval.startUtc,
        endAt: interval.endUtc,
        purpose: input.purpose,
        groupName: input.groupName,
        expectedAttendance: input.expectedAttendance,
      }),
    )
    .digest("hex");
}

function withinHours(
  room: RoomDetail,
  date: string,
  weekday: number,
  startMinutes: number,
  endMinutes: number,
): boolean {
  return room.hours.some(
    (rule) =>
      rule.weekday === weekday &&
      rule.effectiveFrom <= date &&
      (rule.effectiveUntil === null || rule.effectiveUntil >= date) &&
      rule.opensAt <= minutesToTime(startMinutes) &&
      rule.closesAt >= minutesToTime(endMinutes),
  );
}

function buildAlternatives(
  db: RoomRelayDatabase,
  room: RoomDetail,
  interval: CampusInterval,
): SafeAlternative[] {
  if (!room.policy.requestsEnabled) {
    return [];
  }

  const blockers = getAllBlockingBookings(db, room.id);
  const blackouts = loadActiveBlackoutWindows(
    db,
    room.id,
    new Date().toISOString(),
  );
  const alternatives: SafeAlternative[] = [];
  const nowWithNotice =
    Date.now() + room.policy.minimumNoticeMinutes * 60_000;
  const horizon = Date.now() + room.policy.maxAdvanceDays * 24 * 60 * 60_000;
  const step = room.policy.slotIntervalMinutes;
  const duration = interval.durationMinutes;

  for (let day = 0; day <= 7 && alternatives.length < 3; day += 1) {
    const date = addDaysToLocalDate(interval.date, day);
    const weekday = localDateWeekday(date);
    const rules = room.hours.filter(
      (rule) =>
        rule.weekday === weekday &&
        rule.effectiveFrom <= date &&
        (rule.effectiveUntil === null || rule.effectiveUntil >= date),
    );

    if (rules.length === 0) {
      continue;
    }

    const openMinutes = Math.min(
      ...rules.map((rule) => {
        const [hour, minute] = rule.opensAt.split(":").map(Number);
        return hour * 60 + minute;
      }),
    );
    const closeMinutes = Math.max(
      ...rules.map((rule) => {
        const [hour, minute] = rule.closesAt.split(":").map(Number);
        return hour * 60 + minute;
      }),
    );
    const firstSlot = Math.ceil(openMinutes / step) * step;

    for (
      let startMinutes = firstSlot;
      startMinutes + duration <= closeMinutes && alternatives.length < 3;
      startMinutes += step
    ) {
      const endMinutes = startMinutes + duration;
      const parsed = parseCampusInterval(
        date,
        minutesToTime(startMinutes),
        minutesToTime(endMinutes),
      );

      if (!parsed.ok) {
        continue;
      }

      const candidate = parsed.interval;

      if (
        candidate.startEpochMs < nowWithNotice ||
        candidate.startEpochMs > horizon ||
        candidate.startUtc === interval.startUtc ||
        !withinHours(room, date, weekday, startMinutes, endMinutes)
      ) {
        continue;
      }

      const closed = blackouts.some(
        (blackout) =>
          blackout.startMs < candidate.endEpochMs &&
          blackout.endMs > candidate.startEpochMs,
      );

      if (closed) {
        continue;
      }

      const conflict = blockers.some((booking) =>
        intervalsConflict(
          {
            startMs: Date.parse(booking.startAt),
            endMs: Date.parse(booking.endAt),
          },
          { startMs: candidate.startEpochMs, endMs: candidate.endEpochMs },
          room.policy.bufferMinutes,
        ),
      );

      if (conflict) {
        continue;
      }

      alternatives.push({
        date,
        startTime: minutesToTime(startMinutes),
        endTime: minutesToTime(endMinutes),
        label: `${formatCampusDate(candidate.startUtc)} · ${formatCampusTimeRange(
          candidate.startUtc,
          candidate.endUtc,
        )}`,
      });
    }
  }

  return alternatives;
}

function roomReceipt(
  id: string,
  room: RoomDetail,
  interval: CampusInterval,
  input: ReturnType<typeof bookingRequestSubmissionSchema.parse>,
  warnings: EligibilityWarning[],
  nowIso: string,
  status: "pending" | "waitlisted",
): Extract<BookingResult, { ok: true }> {
  return {
    ok: true,
    kind: "created",
    receipt: {
      id,
      roomCode: room.code,
      roomName: room.name,
      building: room.building,
      location: room.location,
      purpose: input.purpose,
      groupName: input.groupName,
      expectedAttendance: input.expectedAttendance,
      startAt: interval.startUtc,
      endAt: interval.endUtc,
      timeZone: interval.timeZone,
      status,
      decisionReason: null,
      createdAt: nowIso,
      eligibilityWarnings: warnings,
    },
    eligibilityWarnings: warnings,
  };
}

export function submitBookingRequest(
  db: RoomRelayDatabase,
  actor: UserProfile,
  submission: BookingRequestSubmission,
): BookingResult {
  const parsed = bookingRequestSubmissionSchema.safeParse(submission);

  if (!parsed.success) {
    return {
      ok: false,
      kind: "validation",
      message:
        parsed.error.issues[0]?.message ?? "Check the request fields and try again.",
      fieldErrors: validationFieldErrors(parsed.error),
    };
  }

  const input = parsed.data;
  const intervalResult = parseCampusInterval(
    input.startDate,
    input.startTime,
    input.endTime,
  );

  if (!intervalResult.ok) {
    return {
      ok: false,
      kind: "validation",
      message: intervalResult.message,
      fieldErrors:
        intervalResult.code === "crosses_midnight" ||
        intervalResult.code === "end_before_start"
          ? { endTime: intervalResult.message }
          : { startTime: intervalResult.message },
    };
  }

  const interval = intervalResult.interval;
  const hash = payloadHash(input, interval);
  const existing = findExistingByKey(
    db,
    actor.id,
    input.idempotencyKey,
  );

  if (existing) {
    if (existing.request_payload_hash !== hash) {
      return {
        ok: false,
        kind: "idempotency_mismatch",
        message:
          "This form was already submitted with different details. Refresh and start a new request.",
      };
    }

    return bookingReceiptFromRow(existing);
  }

  if (actor.role !== "student") {
    return {
      ok: false,
      kind: "forbidden",
      message: "Only student and club-lead accounts can submit room requests.",
    };
  }

  const limit = consumeRateLimit(`booking-request:${actor.id}`, RATE_LIMIT);

  if (!limit.allowed) {
    return {
      ok: false,
      kind: "rate_limited",
      message: "Too many request attempts. Wait a few minutes and try again.",
      retryAfterSeconds: limit.retryAfterSeconds,
    };
  }

  const correlationId = randomUUID();

  try {
    const execute = db.transaction((): BookingResult => {
      const freshProfile = getProfileById(db, actor.id);

      if (!freshProfile || freshProfile.role !== "student") {
        return {
          ok: false,
          kind: "forbidden",
          message: "Your account cannot submit room requests.",
        };
      }

      // Re-check idempotency inside the write transaction in case a concurrent
      // retry won the race.
      const racedExisting = findExistingByKey(
        db,
        freshProfile.id,
        input.idempotencyKey,
      );

      if (racedExisting) {
        if (racedExisting.request_payload_hash !== hash) {
          return {
            ok: false,
            kind: "idempotency_mismatch",
            message:
              "This form was already submitted with different details. Refresh and start a new request.",
          };
        }

        return bookingReceiptFromRow(racedExisting);
      }

      const room = getRoomDetail(db, freshProfile, input.roomCode, null);

      if (!room) {
        return {
          ok: false,
          kind: "unavailable",
          message: "That room is no longer available for requests.",
        };
      }

      if (!room.policy.requestsEnabled) {
        return {
          ok: false,
          kind: "unavailable",
          message: "This room is not accepting requests at this time.",
        };
      }

      if (input.expectedAttendance > room.capacity) {
        return {
          ok: false,
          kind: "validation",
          message: "The expected attendance is above this room's capacity.",
          fieldErrors: {
            expectedAttendance: `This room holds up to ${room.capacity} people.`,
          },
        };
      }

      if (
        interval.startMinutes % room.policy.slotIntervalMinutes !== 0 ||
        interval.endMinutes % room.policy.slotIntervalMinutes !== 0
      ) {
        return {
          ok: false,
          kind: "validation",
          message: "Choose a time on one of the room's booking boundaries.",
          fieldErrors: {
            startTime: `Times must be in ${room.policy.slotIntervalMinutes}-minute increments.`,
          },
        };
      }

      if (interval.durationMinutes > room.policy.maximumDurationMinutes) {
        return {
          ok: false,
          kind: "validation",
          message: "This request is longer than the room policy allows.",
          fieldErrors: {
            endTime: `The maximum duration for this room is ${room.policy.maximumDurationMinutes} minutes.`,
          },
        };
      }

      if (
        interval.startEpochMs <
        Date.now() + room.policy.minimumNoticeMinutes * 60_000
      ) {
        return {
          ok: false,
          kind: "validation",
          message: "This start time is too soon.",
          fieldErrors: {
            startTime: `This room needs at least ${room.policy.minimumNoticeMinutes} minutes' notice.`,
          },
        };
      }

      if (
        interval.startEpochMs >
        Date.now() + room.policy.maxAdvanceDays * 24 * 60 * 60_000
      ) {
        return {
          ok: false,
          kind: "validation",
          message: "This date is too far ahead.",
          fieldErrors: {
            startDate: `This room takes requests up to ${room.policy.maxAdvanceDays} days ahead.`,
          },
        };
      }

      if (
        !checkRoomSchedule(
          db,
          room.id,
          interval.date,
          interval.weekday,
          interval.startMinutes,
          interval.endMinutes,
        )
      ) {
        return {
          ok: false,
          kind: "outside_hours",
          message: "The requested time is outside this room's opening hours.",
          alternatives: buildAlternatives(db, room, interval),
        };
      }

      const [blackout] = findOverlappingBlackouts(
        db,
        room.id,
        interval.startUtc,
        interval.endUtc,
      );

      if (blackout) {
        return {
          ok: false,
          kind: "blackout",
          message: `The room is closed for part of this time: ${blackout.reason}`,
          alternatives: buildAlternatives(db, room, interval),
        };
      }

      const conflict = getBlockingBookings(
        db,
        room.id,
        interval.startUtc,
        interval.endUtc,
        room.policy.bufferMinutes,
      );
      const joiningWaitlist =
        conflict.length > 0 && input.joinWaitlist && room.policy.waitlistEnabled;

      if (conflict.length > 0 && !joiningWaitlist) {
        return {
          ok: false,
          kind: "conflict",
          message: room.policy.waitlistEnabled
            ? "This time is already booked. You can join the waitlist, or choose another time or room."
            : "This time is already booked. Choose another time or room.",
          alternatives: buildAlternatives(db, room, interval),
          waitlistAvailable: room.policy.waitlistEnabled,
        };
      }

      const duplicateBookingId = findPendingDuplicate(db, {
        requesterId: freshProfile.id,
        roomId: room.id,
        startUtc: interval.startUtc,
        endUtc: interval.endUtc,
      });

      if (duplicateBookingId) {
        return {
          ok: false,
          kind: "duplicate",
          message:
            "You already have a request in review or on the waitlist for this room and time.",
          bookingId: duplicateBookingId,
        };
      }

      if (room.policy.maxActivePerRequester > 0) {
        const active = db
          .prepare(
            `SELECT count(*) AS count
             FROM bookings
             WHERE requester_id = ?
               AND room_id = ?
               AND status IN ('pending', 'waitlisted', 'approved', 'checked_in')
               AND julianday(end_at) > julianday(?)`,
          )
          .get(freshProfile.id, room.id, new Date().toISOString()) as {
          count: number;
        };

        if (active.count >= room.policy.maxActivePerRequester) {
          return {
            ok: false,
            kind: "quota",
            message: `You already have ${active.count} upcoming ${
              active.count === 1 ? "request" : "requests"
            } for this room, which is this room's limit per person. Cancel one or wait until one has finished.`,
          };
        }
      }

      const status: "pending" | "waitlisted" = joiningWaitlist
        ? "waitlisted"
        : "pending";

      const nowIso = new Date().toISOString();
      const bookingId = `booking_${randomUUID()}`;
      const snapshot: EligibilitySnapshotItem[] = room.requirements.map(
        (requirement) => ({
          requirementId: requirement.id,
          description: requirement.description,
          required: requirement.required,
          status: requirement.verification,
        }),
      );
      const warnings = snapshot
        .filter(
          (requirement) =>
            requirement.required && requirement.status !== "verified",
        )
        .map((requirement) => ({
          requirementId: requirement.requirementId,
          description: requirement.description,
        }));

      const insertBooking = db.prepare(`
        INSERT INTO bookings (
          id, room_id, requester_id, purpose, group_name, expected_attendance,
          start_at, end_at, status, decision_reason, decided_by, decided_at,
          created_at, updated_at, submission_key, request_payload_hash,
          eligibility_snapshot_json, waitlisted_at
        ) VALUES (
          @id, @room_id, @requester_id, @purpose, @group_name, @expected_attendance,
          @start_at, @end_at, @status, NULL, NULL, NULL,
          @created_at, @updated_at, @submission_key, @request_payload_hash,
          @eligibility_snapshot_json, @waitlisted_at
        )
      `);

      insertBooking.run({
        id: bookingId,
        room_id: room.id,
        requester_id: freshProfile.id,
        purpose: input.purpose,
        group_name: input.groupName,
        expected_attendance: input.expectedAttendance,
        start_at: interval.startUtc,
        end_at: interval.endUtc,
        created_at: nowIso,
        updated_at: nowIso,
        submission_key: input.idempotencyKey,
        request_payload_hash: hash,
        eligibility_snapshot_json: JSON.stringify(snapshot),
        status,
        waitlisted_at: status === "waitlisted" ? nowIso : null,
      });

      recordAudit(db, {
        actorId: freshProfile.id,
        action:
          status === "waitlisted" ? "booking.waitlist_joined" : "booking.submitted",
        entityType: "booking",
        entityId: bookingId,
        occurredAt: nowIso,
        summary:
          status === "waitlisted"
            ? `${freshProfile.displayName} joined the waitlist for ${room.name}.`
            : `${freshProfile.displayName} submitted a pending request for ${room.name}.`,
        correlationId: `booking-submission:${correlationId}`,
        metadata: {
          roomCode: room.code,
          startAt: interval.startUtc,
          endAt: interval.endUtc,
          outstandingRequirementIds: warnings.map(
            (warning) => warning.requirementId,
          ),
          timeZone: interval.timeZone,
          waitlist: status === "waitlisted",
        },
      });

      if (status === "pending") {
        const managerId = activeRoomManagerId(db, room.id);

        if (managerId) {
          createNotification(db, {
            recipientId: managerId,
            kind: "request_submitted",
            title: `New request: ${room.name}`,
            body: `${freshProfile.displayName} asked for ${formatCampusDateTime(
              interval.startUtc,
              interval.endUtc,
            )} (${input.expectedAttendance} ${
              input.expectedAttendance === 1 ? "person" : "people"
            }).${warnings.length > 0 ? " Eligibility needs checking." : ""}`,
            linkPath: reviewerLink(bookingId),
            bookingId,
            createdAt: nowIso,
          });
        }
      }

      return roomReceipt(
        bookingId,
        room,
        interval,
        input,
        warnings,
        nowIso,
        status,
      );
    });

    return execute.immediate();
  } catch (error) {
    console.error(
      "Booking submission failed:",
      correlationId,
      error instanceof Error ? error.message : "unknown error",
    );

    return {
      ok: false,
      kind: "service_error",
      message: "The request could not be saved. Please try again.",
      correlationId,
    };
  }
}
