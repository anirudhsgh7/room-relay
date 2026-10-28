import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookingStatusChip, StatusChip } from "@/components/badges";
import { requireCurrentProfile } from "@/lib/auth/session";
import { listMyBookings } from "@/lib/bookings/queries";
import { getCampusTimezone } from "@/lib/config";
import { getDatabase } from "@/lib/db/client";
import { formatCampusDateTime } from "@/lib/time/campus-time";

export const metadata: Metadata = {
  title: "My requests",
  description: "View your RoomRelay room requests and their current status.",
};

export default async function MyBookingsPage() {
  const profile = await requireCurrentProfile();

  if (profile.role !== "student") {
    redirect("/app/rooms");
  }

  const timezone = getCampusTimezone();
  const bookings = listMyBookings(getDatabase(), profile);
  const pendingCount = bookings.filter(
    (booking) => booking.status === "pending",
  ).length;

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <p className="eyebrow">Requester workspace</p>
            <StatusChip tone="neutral">Private to you</StatusChip>
          </div>
          <h1 className="mt-3 font-display text-4xl leading-[1.03] tracking-[-0.04em] text-ink-950 sm:text-5xl">
            My requests
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-700">
            Track every request you have submitted. Pending is not permission to
            enter; a room manager still needs to review it.
          </p>
        </div>
        <Link href="/app/rooms" className="btn-primary shrink-0">
          Find another room
        </Link>
      </section>

      <section className="rounded-2xl border border-flag-amber/20 bg-flag-amber-bg p-4 text-sm leading-6 text-flag-amber">
        <p className="font-bold">Pending requests do not reserve a room.</p>
        <p className="mt-1 text-xs leading-5">
          Wait for a manager decision before treating any booking as approved.
          Approved means the room/time is allocated; physical access is a later
          phase.
        </p>
      </section>

      <section aria-labelledby="request-list-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Your history</p>
            <h2
              id="request-list-heading"
              className="mt-1.5 text-xl font-bold tracking-tight text-ink-950"
            >
              {bookings.length} {bookings.length === 1 ? "request" : "requests"}
            </h2>
          </div>
          {pendingCount > 0 ? (
            <StatusChip tone="amber">
              {pendingCount} awaiting manager review
            </StatusChip>
          ) : null}
        </div>

        {bookings.length > 0 ? (
          <div className="surface mt-4 overflow-hidden">
            <div className="hidden grid-cols-[1.3fr_1fr_0.8fr_0.7fr] gap-4 border-b border-sand-200 bg-sand-50 px-5 py-3 text-[0.62rem] font-bold uppercase tracking-[0.13em] text-ink-600 lg:grid">
              <span>Room</span>
              <span>Campus time</span>
              <span>Purpose</span>
              <span>Status</span>
            </div>
            <ul className="divide-y divide-sand-200">
              {bookings.map((booking) => (
                <li key={booking.id}>
                  <Link
                    href={`/app/bookings/${booking.id}`}
                    className="group grid gap-3 px-4 py-4 transition hover:bg-sand-50 sm:px-5 lg:grid-cols-[1.3fr_1fr_0.8fr_0.7fr] lg:items-center lg:gap-4"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-ink-950 group-hover:text-brand-700">
                        {booking.roomName}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-600">
                        {booking.building} · {booking.roomCode}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-ink-900">
                        {formatCampusDateTime(
                          booking.startAt,
                          booking.endAt,
                          timezone,
                        )}
                      </p>
                      <p className="mt-0.5 text-[0.65rem] text-ink-600">
                        {booking.expectedAttendance} attending
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs text-ink-700">
                        {booking.purpose}
                      </p>
                      {booking.groupName ? (
                        <p className="mt-0.5 truncate text-[0.65rem] text-ink-600">
                          {booking.groupName}
                        </p>
                      ) : null}
                      {booking.decisionReason &&
                      (booking.status === "approved" ||
                        booking.status === "rejected") ? (
                        <p className="mt-1 line-clamp-1 text-[0.62rem] text-ink-600">
                          Decision: {booking.decisionReason}
                        </p>
                      ) : null}
                      {booking.cancellationReason ? (
                        <p className="mt-1 line-clamp-1 text-[0.62rem] text-ink-600">
                          Cancelled: {booking.cancellationReason}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <BookingStatusChip status={booking.status} />
                      {booking.eligibilityWarnings.length > 0 &&
                      booking.status === "pending" ? (
                        <StatusChip tone="amber">Eligibility review</StatusChip>
                      ) : null}
                      <svg
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden="true"
                        className="ml-auto size-3.5 text-ink-600 transition group-hover:translate-x-0.5"
                      >
                        <path
                          d="M3.5 8h9M9 4.5 12.5 8 9 11.5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="surface mt-4 flex flex-col items-center justify-center px-6 py-14 text-center">
            <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                className="size-5"
              >
                <path
                  d="M5 7.5V19h14V7.5M5 7.5h14M8 7.5V5h8v2.5M9 12h6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <h3 className="mt-4 text-base font-bold text-ink-950">
              No requests yet.
            </h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-ink-600">
              Find a room that fits your group, then submit a request for manager
              review.
            </p>
            <Link href="/app/rooms" className="btn-primary mt-5">
              Discover rooms
            </Link>
          </div>
        )}
      </section>

      <p className="text-center text-[0.65rem] leading-5 text-ink-600/80">
        Showing only requests linked to {profile.displayName}. Times are shown in{" "}
        {timezone}.
      </p>
    </div>
  );
}
