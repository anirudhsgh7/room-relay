import type { RoomRelayDatabase } from "@/lib/db/client";
import { recordAudit } from "@/lib/audit";
import {
  getAllocationStanding,
  loadConflictingCandidates,
  loadRoomPolicy,
  rankCandidates,
  type AllocationStanding,
} from "@/lib/allocation/ranking";
import {
  activeRoomManagerId,
  createNotification,
  requesterLink,
  reviewerLink,
} from "@/lib/notifications/service";
import { findOverlappingBlackouts } from "@/lib/rooms/blackouts";
import { checkRoomSchedule, getBlockingBookings } from "@/lib/rooms/availability";
import { ALLOCATION_RULE_COPY } from "@/lib/rooms/policy";
import type { RoomPolicy } from "@/lib/rooms/types";
import {
  formatCampusDateTime,
  localIntervalParts,
} from "@/lib/time/campus-time";

export const AUTO_DECLINE_REASON =
  "Another request for this time was approved under the room's published allocation rule, and this room does not keep a waitlist.";

interface ApprovedBooking {
  id: string;
  roomId: string;
  roomName: string;
  startAt: string;
  endAt: string;
}

interface Actor {
  id: string;
  displayName: string;
}

/**
 * After an approval, every pending request that now conflicts with the
 * confirmed booking can no longer be approved. Rather than leaving them to fail
 * later, they move to the waitlist (or are declined when the room has no
 * waitlist) in the same transaction, and each requester is told why.
 */
export function settleConflictsAfterApproval(
  db: RoomRelayDatabase,
  input: {
    booking: ApprovedBooking;
    policy: RoomPolicy;
    actor: Actor;
    nowIso: string;
    correlationId: string;
  },
): { waitlistedIds: string[]; declinedIds: string[] } {
  const now = new Date(input.nowIso);
  const conflicts = loadConflictingCandidates(
    db,
    {
      roomId: input.booking.roomId,
      excludeBookingId: input.booking.id,
      startAt: input.booking.startAt,
      endAt: input.booking.endAt,
      bufferMinutes: input.policy.bufferMinutes,
      statuses: ["pending"],
    },
    now,
  );
  const ruleLabel = ALLOCATION_RULE_COPY[input.policy.allocationRule].label;
  const waitlistedIds: string[] = [];
  const declinedIds: string[] = [];

  for (const request of conflicts) {
    const slot = formatCampusDateTime(request.startAt, request.endAt);

    if (input.policy.waitlistEnabled) {
      const update = db
        .prepare(
          `UPDATE bookings
           SET status = 'waitlisted', waitlisted_at = @now, updated_at = @now
           WHERE id = @id AND status = 'pending'`,
        )
        .run({ id: request.id, now: input.nowIso });

      if (update.changes !== 1) {
        continue;
      }

      waitlistedIds.push(request.id);
      recordAudit(db, {
        actorId: input.actor.id,
        action: "booking.waitlisted",
        entityType: "booking",
        entityId: request.id,
        occurredAt: input.nowIso,
        summary: `Moved to the waitlist after a competing request for ${input.booking.roomName} was approved.`,
        correlationId: `booking-waitlist:${input.correlationId}`,
        metadata: {
          approvedBookingId: input.booking.id,
          allocationRule: input.policy.allocationRule,
        },
      });
      continue;
    }

    const update = db
      .prepare(
        `UPDATE bookings
         SET status = 'rejected',
             decision_reason = @reason,
             decided_by = @decided_by,
             decided_at = @now,
             eligibility_override_reason = NULL,
             eligibility_override_requirement_ids_json = NULL,
             updated_at = @now
         WHERE id = @id AND status = 'pending'`,
      )
      .run({
        id: request.id,
        reason: AUTO_DECLINE_REASON,
        decided_by: input.actor.id,
        now: input.nowIso,
      });

    if (update.changes !== 1) {
      continue;
    }

    declinedIds.push(request.id);
    recordAudit(db, {
      actorId: input.actor.id,
      action: "booking.rejected",
      entityType: "booking",
      entityId: request.id,
      occurredAt: input.nowIso,
      summary: `Declined because a competing request for ${input.booking.roomName} was approved and the room keeps no waitlist.`,
      correlationId: `booking-auto-decline:${input.correlationId}`,
      metadata: {
        reason: AUTO_DECLINE_REASON,
        approvedBookingId: input.booking.id,
        automatic: true,
      },
    });
    createNotification(db, {
      recipientId: request.requesterId,
      kind: "decision_rejected",
      title: `${input.booking.roomName} was allocated to another request`,
      body: `Your request for ${slot} was not approved. Another request for the same time was approved under the room's published rule (${ruleLabel}). Try another time or room.`,
      linkPath: requesterLink(request.id),
      bookingId: request.id,
      createdAt: input.nowIso,
    });
  }

  // Positions are computed after every move so each requester sees their
  // place in the final waitlist, not an intermediate one.
  for (const bookingId of waitlistedIds) {
    const request = conflicts.find((candidate) => candidate.id === bookingId);

    if (!request) {
      continue;
    }

    const standing = getWaitlistStanding(db, bookingId, now);
    const slot = formatCampusDateTime(request.startAt, request.endAt);
    const place = standing ? `You are number ${standing.position} on the waitlist.` : "";

    createNotification(db, {
      recipientId: request.requesterId,
      kind: "waitlisted",
      title: `You're on the waitlist for ${input.booking.roomName}`,
      body: `Another request for ${slot} was approved under the room's published rule (${ruleLabel}). ${place} If the time frees up, your request goes back to review automatically. You don't need to resubmit.`,
      linkPath: requesterLink(bookingId),
      bookingId,
      createdAt: input.nowIso,
    });
  }

  return { waitlistedIds, declinedIds };
}

interface RoomRow {
  id: string;
  name: string;
  status: string;
}

/**
 * Returns waitlisted requests to review when the time they wanted becomes
 * free. A request is returned only if it could now be approved: it starts in
 * the future, is within opening hours, is outside any closure, and no
 * confirmed booking blocks it. Several may return at once; the published rule
 * then orders them in the review queue.
 */
export function promoteWaitlist(
  db: RoomRelayDatabase,
  input: {
    roomId: string;
    freedStartAt: string;
    freedEndAt: string;
    nowIso: string;
    correlationId: string;
    cause: string;
  },
): string[] {
  const room = db
    .prepare("SELECT id, name, status FROM rooms WHERE id = ?")
    .get(input.roomId) as RoomRow | undefined;
  const policy = loadRoomPolicy(db, input.roomId);

  if (!room || room.status !== "active" || !policy || !policy.requestsEnabled) {
    return [];
  }

  const now = new Date(input.nowIso);
  const waitlisted = rankCandidates(
    policy.allocationRule,
    loadConflictingCandidates(
      db,
      {
        roomId: room.id,
        excludeBookingId: null,
        startAt: input.freedStartAt,
        endAt: input.freedEndAt,
        bufferMinutes: policy.bufferMinutes,
        statuses: ["waitlisted"],
      },
      now,
    ),
  );
  const managerId = activeRoomManagerId(db, room.id);
  const promoted: string[] = [];

  for (const request of waitlisted) {
    if (Date.parse(request.startAt) <= now.getTime()) {
      continue;
    }

    const local = localIntervalParts(request.startAt, request.endAt);

    if (
      !local.sameLocalDate ||
      !checkRoomSchedule(
        db,
        room.id,
        local.date,
        local.weekday,
        local.startMinutes,
        local.endMinutes,
      )
    ) {
      continue;
    }

    if (
      findOverlappingBlackouts(db, room.id, request.startAt, request.endAt)
        .length > 0
    ) {
      continue;
    }

    if (
      getBlockingBookings(
        db,
        room.id,
        request.startAt,
        request.endAt,
        policy.bufferMinutes,
      ).length > 0
    ) {
      continue;
    }

    const update = db
      .prepare(
        `UPDATE bookings
         SET status = 'pending', promoted_at = @now, updated_at = @now
         WHERE id = @id AND status = 'waitlisted'`,
      )
      .run({ id: request.id, now: input.nowIso });

    if (update.changes !== 1) {
      continue;
    }

    promoted.push(request.id);
    const slot = formatCampusDateTime(request.startAt, request.endAt);

    recordAudit(db, {
      actorId: null,
      action: "booking.promoted",
      entityType: "booking",
      entityId: request.id,
      occurredAt: input.nowIso,
      summary: `Returned to review automatically because ${room.name} became free (${input.cause}).`,
      correlationId: `booking-promotion:${input.correlationId}`,
      metadata: { cause: input.cause },
    });
    createNotification(db, {
      recipientId: request.requesterId,
      kind: "waitlist_promoted",
      title: `A slot opened in ${room.name}`,
      body: `The time you waitlisted for (${slot}) is free again, so your request is back with the room manager for review. It is not approved yet.`,
      linkPath: requesterLink(request.id),
      bookingId: request.id,
      createdAt: input.nowIso,
    });

    if (managerId) {
      createNotification(db, {
        recipientId: managerId,
        kind: "decision_needed",
        title: `Waitlisted request back in review: ${room.name}`,
        body: `${request.requesterName}'s request for ${slot} returned from the waitlist because the time became free.`,
        linkPath: reviewerLink(request.id),
        bookingId: request.id,
        createdAt: input.nowIso,
      });
    }
  }

  return promoted;
}

/** Position among waitlisted requests that want an overlapping time. */
export function getWaitlistStanding(
  db: RoomRelayDatabase,
  bookingId: string,
  now = new Date(),
): AllocationStanding | null {
  return getAllocationStanding(db, bookingId, ["waitlisted"], now);
}

/** Position among pending requests that compete for an overlapping time. */
export function getReviewStanding(
  db: RoomRelayDatabase,
  bookingId: string,
  now = new Date(),
): AllocationStanding | null {
  return getAllocationStanding(db, bookingId, ["pending"], now);
}
