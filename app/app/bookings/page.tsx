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
  title: "My bookings",
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
          <h1 className="font-display text-4xl leading-[1.05] tracking-[-0.03em] text-ink-950 sm:text-5xl">
            My bookings
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-ink-700">
            Everything you&apos;ve asked for, in date order from earliest to
            latest. Open one to see the decision, cancel, or check out.
          </p>
        </div>
        <Link href="/app/rooms" className="btn-primary shrink-0">
          Find a room
        </Link>
      </section>

      <section aria-labelledby="request-list-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2
              id="request-list-heading"
              className="mt-1.5 text-xl font-bold tracking-tight text-ink-950"
            >
              {bookings.length} {bookings.length === 1 ? "booking or request" : "bookings and requests"}
            </h2>
          </div>
          {pendingCount > 0 ? (
            <StatusChip tone="amber">
              {pendingCount} waiting for a decision
            </StatusChip>
          ) : null}
        </div>

        {bookings.length > 0 ? (
          <div className="surface mt-4 overflow-hidden">
            <div className="hidden grid-cols-[1.3fr_1fr_0.8fr_0.7fr] gap-4 border-b border-sand-200 bg-sand-50 px-5 py-3 text-xs font-semibold text-ink-600 lg:grid">
              <span>Room</span>
              <span>When</span>
              <span>What for</span>
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
                        {booking.expectedAttendance} people
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
                          Manager: {booking.decisionReason}
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
                        <StatusChip tone="amber">Requirements to check</StatusChip>
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
              Nothing booked yet
            </h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-ink-600">
              Find a room that fits your group and send a request. It shows up
              here with its status.
            </p>
            <Link href="/app/rooms" className="btn-primary mt-5">
              Find a room
            </Link>
          </div>
        )}
      </section>

      <p className="text-center text-xs leading-5 text-ink-600">
        Times are campus time ({timezone}).
      </p>
    </div>
  );
}
