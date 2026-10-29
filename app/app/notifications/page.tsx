import type { Metadata } from "next";
import Link from "next/link";
import { markAllReadAction, openNotificationAction } from "@/app/app/notifications/actions";
import { requireCurrentProfile } from "@/lib/auth/session";
import { getDatabase } from "@/lib/db/client";
import {
  listNotifications,
  type NotificationTone,
} from "@/lib/notifications/service";
import { formatRelative } from "@/lib/time/relative";

export const metadata: Metadata = {
  title: "Notifications",
  description: "Decisions, reminders, and updates about your bookings.",
};

const DOTS: Record<NotificationTone, string> = {
  good: "bg-flag-green",
  attention: "bg-flag-amber",
  problem: "bg-flag-red",
  neutral: "bg-ink-600/50",
};

export default async function NotificationsPage() {
  const profile = await requireCurrentProfile();
  const items = await listNotifications(getDatabase(), profile, { limit: 100 });
  const unread = items.filter((item) => !item.readAt).length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-[-0.03em] text-ink-950">Notifications</h1>
          <p className="mt-2 text-sm text-ink-700">
            {unread > 0
              ? `${unread} unread. Open one to see the booking or request it is about.`
              : "You're all caught up."}
          </p>
        </div>
        {unread > 0 ? (
          <form action={markAllReadAction}>
            <button type="submit" className="btn-secondary">
              Mark all as read
            </button>
          </form>
        ) : null}
      </header>

      {items.length === 0 ? (
        <section className="surface px-6 py-12 text-center">
          <h2 className="text-lg font-bold text-ink-950">Nothing here yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-600">
            Decisions on your requests, waitlist updates, and reminders before
            each booking will appear here.
          </p>
          <Link href="/app/rooms" className="btn-primary mt-5">
            Find a room
          </Link>
        </section>
      ) : (
        <ul className="surface divide-y divide-sand-200 overflow-hidden">
          {items.map((item) => (
            <li key={item.id}>
              <form action={openNotificationAction}>
                <input type="hidden" name="notificationId" value={item.id} />
                <button
                  type="submit"
                  className={`flex w-full gap-3 px-5 py-4 text-left transition hover:bg-sand-50 ${
                    item.readAt ? "" : "bg-brand-50/40"
                  }`}
                >
                  <span
                    className={`mt-1.5 size-2.5 shrink-0 rounded-full ${DOTS[item.tone]} ${
                      item.readAt ? "opacity-40" : ""
                    }`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span
                        className={`text-sm text-ink-950 ${item.readAt ? "font-medium" : "font-bold"}`}
                      >
                        {item.title}
                        {item.readAt ? null : <span className="sr-only"> (unread)</span>}
                      </span>
                      <time dateTime={item.createdAt} className="text-xs text-ink-600">
                        {formatRelative(item.createdAt)}
                      </time>
                    </span>
                    <span className="mt-1 block text-sm leading-6 text-ink-700">{item.body}</span>
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs leading-5 text-ink-600">
        Notifications appear here in the app. Email and text delivery are not
        connected in this version.
      </p>
    </div>
  );
}
