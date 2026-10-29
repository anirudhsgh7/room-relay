import { randomUUID } from "node:crypto";
import type { UserProfile } from "@/lib/auth/service";
import type { RoomRelayDatabase } from "@/lib/db/client";

export const NOTIFICATION_KINDS = [
  "request_submitted",
  "decision_approved",
  "decision_rejected",
  "booking_cancelled",
  "booking_cancelled_by_staff",
  "waitlisted",
  "waitlist_promoted",
  "waitlist_lapsed",
  "request_lapsed",
  "reminder_start",
  "reminder_checkout",
  "checkout_overdue",
  "decision_needed",
  "incident_update",
  "room_assignment",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationTone = "good" | "attention" | "problem" | "neutral";

export const NOTIFICATION_TONES: Record<NotificationKind, NotificationTone> = {
  request_submitted: "neutral",
  decision_approved: "good",
  decision_rejected: "problem",
  booking_cancelled: "neutral",
  booking_cancelled_by_staff: "problem",
  waitlisted: "attention",
  waitlist_promoted: "good",
  waitlist_lapsed: "neutral",
  request_lapsed: "attention",
  reminder_start: "neutral",
  reminder_checkout: "attention",
  checkout_overdue: "problem",
  decision_needed: "attention",
  incident_update: "neutral",
  room_assignment: "neutral",
};

export interface NotificationInput {
  recipientId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  linkPath?: string | null;
  bookingId?: string | null;
  /** Makes the notification deliverable at most once per recipient. */
  dedupeKey?: string | null;
  createdAt?: string;
}

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  tone: NotificationTone;
  title: string;
  body: string;
  linkPath: string | null;
  bookingId: string | null;
  createdAt: string;
  readAt: string | null;
}

interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  link_path: string | null;
  booking_id: string | null;
  created_at: string;
  read_at: string | null;
}

function isKind(value: string): value is NotificationKind {
  return NOTIFICATION_KINDS.includes(value as NotificationKind);
}

function toItem(row: NotificationRow): NotificationItem {
  const kind: NotificationKind = isKind(row.kind) ? row.kind : "booking_cancelled";

  return {
    id: row.id,
    kind,
    tone: NOTIFICATION_TONES[kind],
    title: row.title,
    body: row.body,
    linkPath: row.link_path,
    bookingId: row.booking_id,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

/**
 * Records one in-app notification. Call it inside the same transaction as the
 * state change it describes so a notification never exists for a change that
 * rolled back. Returns false when the dedupe key was already delivered.
 */
export function createNotification(
  db: RoomRelayDatabase,
  input: NotificationInput,
): boolean {
  const linkPath =
    input.linkPath && input.linkPath.startsWith("/app") ? input.linkPath : null;
  const result = db
    .prepare(
      `INSERT INTO notifications (
         id, recipient_id, kind, title, body, link_path, booking_id,
         dedupe_key, created_at, read_at
       ) VALUES (
         @id, @recipient_id, @kind, @title, @body, @link_path, @booking_id,
         @dedupe_key, @created_at, NULL
       )
       ON CONFLICT DO NOTHING`,
    )
    .run({
      id: `ntf_${randomUUID()}`,
      recipient_id: input.recipientId,
      kind: input.kind,
      title: input.title.trim(),
      body: input.body.trim(),
      link_path: linkPath,
      booking_id: input.bookingId ?? null,
      dedupe_key: input.dedupeKey ?? null,
      created_at: input.createdAt ?? new Date().toISOString(),
    });

  return result.changes === 1;
}

export function listNotifications(
  db: RoomRelayDatabase,
  profile: UserProfile,
  options: { limit?: number; unreadOnly?: boolean } = {},
): NotificationItem[] {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const rows = db
    .prepare(
      `SELECT id, kind, title, body, link_path, booking_id, created_at, read_at
       FROM notifications
       WHERE recipient_id = ?
         ${options.unreadOnly ? "AND read_at IS NULL" : ""}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(profile.id, limit) as NotificationRow[];

  return rows.map(toItem);
}

export function countUnreadNotifications(
  db: RoomRelayDatabase,
  profileId: string,
): number {
  const row = db
    .prepare(
      `SELECT count(*) AS count
       FROM notifications
       WHERE recipient_id = ? AND read_at IS NULL`,
    )
    .get(profileId) as { count: number };

  return row.count;
}

/** Marks one of the actor's own notifications as read. */
export function markNotificationRead(
  db: RoomRelayDatabase,
  profile: UserProfile,
  notificationId: string,
): boolean {
  const result = db
    .prepare(
      `UPDATE notifications
       SET read_at = ?
       WHERE id = ? AND recipient_id = ? AND read_at IS NULL`,
    )
    .run(new Date().toISOString(), notificationId, profile.id);

  return result.changes === 1;
}

export function markAllNotificationsRead(
  db: RoomRelayDatabase,
  profile: UserProfile,
): number {
  const result = db
    .prepare(
      `UPDATE notifications
       SET read_at = ?
       WHERE recipient_id = ? AND read_at IS NULL`,
    )
    .run(new Date().toISOString(), profile.id);

  return result.changes;
}

/** The active manager assigned to a room, or null if the room has none. */
export function activeRoomManagerId(
  db: RoomRelayDatabase,
  roomId: string,
): string | null {
  const row = db
    .prepare(
      `SELECT p.id
       FROM rooms r
       JOIN profiles p ON p.id = r.manager_id
       WHERE r.id = ? AND p.status = 'active'`,
    )
    .get(roomId) as { id: string } | undefined;

  return row?.id ?? null;
}

export function requesterLink(bookingId: string): string {
  return `/app/bookings/${bookingId}`;
}

export function reviewerLink(bookingId: string): string {
  return `/app/manager/requests/${bookingId}`;
}
