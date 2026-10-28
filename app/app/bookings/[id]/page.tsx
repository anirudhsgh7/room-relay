import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingStatusChip, StatusChip } from "@/components/badges";
import { CancelBookingForm } from "@/components/bookings/cancel-booking-form";
import { CheckoutForm } from "@/components/bookings/checkout-form";
import { LifecycleTimeline } from "@/components/timeline/lifecycle-timeline";
import { requireCurrentProfile } from "@/lib/auth/session";
import { getMyBooking } from "@/lib/bookings/queries";
import { getBookingTimeline } from "@/lib/bookings/timeline";
import { getCampusTimezone } from "@/lib/config";
import { getDatabase } from "@/lib/db/client";
import { getBookingIncidents } from "@/lib/incidents/queries";
import {
  formatCampusDate,
  formatCampusTime,
  formatCampusTimeRange,
} from "@/lib/time/campus-time";

export const metadata: Metadata = {
  title: "Request details",
  description: "View your RoomRelay request status and details.",
};

export default async function BookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    created?: string | string[];
    cancelled?: string | string[];
    checkedout?: string | string[];
  }>;
}) {
  const profile = await requireCurrentProfile();

  if (profile.role !== "student") {
    notFound();
  }

  const { id } = await params;
  const query = await searchParams;
  const db = getDatabase();
  const booking = getMyBooking(db, profile, id);

  if (!booking) {
    notFound();
  }

  const timezone = getCampusTimezone();
  const justCreated = query.created === "1";
  const justCancelled = query.cancelled === "1";
  const justCheckedOut = query.checkedout === "1";
  const canCancel = booking.canCancel;
  const incidents = getBookingIncidents(db, booking.id);
  const timeline = getBookingTimeline(db, profile, booking.id);

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-xs text-ink-600" aria-label="Breadcrumb">
        <Link href="/app/bookings" className="hover:text-ink-950">
          My requests
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-semibold text-ink-800">Request details</span>
      </nav>

      {justCreated ? (
        <section className="rounded-2xl border border-flag-green/20 bg-flag-green-bg p-5 text-flag-green">
          <div className="flex gap-3">
            <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-white/60">
              <svg
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
                className="size-4"
              >
                <path
                  d="m3 8.2 3.1 3.1L13 4.8"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <div>
              <h2 className="text-lg font-bold">Request submitted</h2>
              <p className="mt-1 text-sm leading-6">
                It is now pending manager review. This is not permission to
                enter the room.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {justCancelled ? (
        <section className="rounded-2xl border border-sand-300 bg-sand-100 p-5 text-ink-800">
          <h2 className="text-lg font-bold">Booking cancelled</h2>
          <p className="mt-1 text-sm leading-6">
            The requested time has been released. Your cancellation reason and
            booking history remain visible below.
          </p>
        </section>
      ) : null}

      {justCheckedOut ? (
        <section
          className={`rounded-2xl border p-5 ${
            booking.status === "incident"
              ? "border-flag-amber/20 bg-flag-amber-bg text-flag-amber"
              : "border-flag-green/20 bg-flag-green-bg text-flag-green"
          }`}
        >
          <h2 className="text-lg font-bold">
            {booking.status === "incident"
              ? "Check-out recorded — incident open"
              : "Booking completed"}
          </h2>
          <p className="mt-1 text-sm leading-6">
            {booking.status === "incident"
              ? "Your condition note and issue were saved. The incident now needs human review; no automatic penalty was applied."
              : "Your room condition note was saved and this booking is complete."}
          </p>
        </section>
      ) : null}

      {booking.status === "approved" && !justCreated ? (
        <section className="rounded-2xl border border-flag-green/20 bg-flag-green-bg p-4 text-sm leading-6 text-flag-green">
          <p className="font-bold">Approved by the room manager</p>
          <p className="mt-1 text-xs leading-5">
            The room/time is allocated. This is a booking decision, not a
            confirmation that a physical door was unlocked. Access is handled in
            Phase 4.
          </p>
        </section>
      ) : null}

      {booking.status === "rejected" ? (
        <section className="rounded-2xl border border-flag-red/20 bg-flag-red-bg p-4 text-sm leading-6 text-flag-red">
          <p className="font-bold">This request was not approved</p>
          <p className="mt-1 text-xs leading-5">
            Read the manager&apos;s reason below. You can submit a new request
            for another time or room.
          </p>
        </section>
      ) : null}

      <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <p className="eyebrow">Request receipt</p>
            <BookingStatusChip status={booking.status} />
            {booking.eligibilityWarnings.length > 0 ? (
              <StatusChip tone="amber">Eligibility review</StatusChip>
            ) : null}
          </div>
          <h1 className="mt-3 max-w-3xl font-display text-4xl leading-[1.03] tracking-[-0.04em] text-ink-950 sm:text-5xl">
            {booking.roomName}
          </h1>
          <p className="mt-3 text-sm leading-6 text-ink-700">
            {booking.building} · {booking.location} · {booking.roomCode}
          </p>
        </div>
        <Link href="/app/bookings" className="btn-secondary shrink-0">
          Back to my requests
        </Link>
      </section>

      {booking.status === "pending" ? (
        <section className="rounded-2xl border border-flag-amber/20 bg-flag-amber-bg p-4 text-sm leading-6 text-flag-amber">
          <p className="font-bold">Pending manager review</p>
          <p className="mt-1 text-xs leading-5">
            This request is <strong>not permission to enter</strong> the room and
            does not reserve it. A manager must approve it before the access
            workflow can treat it as valid.
          </p>
        </section>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.3fr_0.9fr]">
        <section className="surface overflow-hidden">
          <div className="border-b border-sand-200 px-5 py-4 sm:px-6">
            <p className="text-sm font-bold text-ink-950">Request details</p>
            <p className="mt-0.5 text-xs text-ink-600">
              Reference {booking.id}
            </p>
          </div>
          <dl className="divide-y divide-sand-200">
            {[
              {
                label: "Status",
                value: <BookingStatusChip status={booking.status} />,
              },
              {
                label: "Campus date",
                value: formatCampusDate(booking.startAt, timezone),
              },
              {
                label: "Time",
                value: formatCampusTimeRange(
                  booking.startAt,
                  booking.endAt,
                  timezone,
                ),
              },
              {
                label: "Purpose",
                value: booking.purpose,
              },
              {
                label: "Group",
                value: booking.groupName ?? "Not specified",
              },
              {
                label: "Expected attendance",
                value: `${booking.expectedAttendance}`,
              },
              {
                label: "Requested by",
                value: profile.displayName,
              },
              ...(booking.checkedInAt
                ? [
                    {
                      label: "Checked in",
                      value: `${formatCampusDate(
                        booking.checkedInAt,
                        timezone,
                      )} · ${formatCampusTime(booking.checkedInAt, timezone)}`,
                    },
                  ]
                : []),
              ...(booking.checkedOutAt
                ? [
                    {
                      label: "Checked out",
                      value: `${formatCampusDate(
                        booking.checkedOutAt,
                        timezone,
                      )} · ${formatCampusTime(booking.checkedOutAt, timezone)}`,
                    },
                  ]
                : []),
              ...(booking.closureReason
                ? [
                    {
                      label: "Closure",
                      value: booking.closureReason.replaceAll("_", " "),
                    },
                  ]
                : []),
            ].map((row) => (
              <div
                key={row.label}
                className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:px-6"
              >
                <dt className="text-xs text-ink-600">{row.label}</dt>
                <dd className="max-w-xl text-sm font-semibold text-ink-950 sm:text-right">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {booking.decisionReason ? (
            <div className="border-t border-sand-200 bg-sand-50 px-5 py-4 sm:px-6">
              <p className="text-[0.64rem] font-bold uppercase tracking-[0.13em] text-ink-600">
                Manager decision reason
              </p>
              <p className="mt-1.5 text-sm leading-6 text-ink-800">
                {booking.decisionReason}
              </p>
              <p className="mt-2 text-[0.65rem] text-ink-600">
                {booking.decisionActorName
                  ? `By ${booking.decisionActorName}`
                  : "Decision recorded"}
                {booking.decidedAt
                  ? ` · ${formatCampusDate(
                      booking.decidedAt,
                      timezone,
                    )} ${formatCampusTime(booking.decidedAt, timezone)}`
                  : ""}
              </p>
            </div>
          ) : null}
          {booking.cancellationReason ? (
            <div className="border-t border-sand-200 bg-flag-red-bg/35 px-5 py-4 sm:px-6">
              <p className="text-[0.64rem] font-bold uppercase tracking-[0.13em] text-ink-600">
                Cancellation reason
              </p>
              <p className="mt-1.5 text-sm leading-6 text-ink-800">
                {booking.cancellationReason}
              </p>
              {booking.cancelledAt ? (
                <p className="mt-2 text-[0.65rem] text-ink-600">
                  {formatCampusDate(booking.cancelledAt, timezone)}{" "}
                  {formatCampusTime(booking.cancelledAt, timezone)}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        <div className="space-y-5">
          <section className="surface p-5">
            <p className="eyebrow">Eligibility snapshot</p>
            {booking.eligibilityWarnings.length > 0 ? (
              <>
                <p className="mt-3 text-sm leading-6 text-ink-700">
                  These requirements were not verified when this request was
                  submitted. A manager must review them before approval.
                </p>
                <ul className="mt-4 space-y-2.5">
                  {booking.eligibilityWarnings.map((warning) => (
                    <li
                      key={warning.requirementId}
                      className="rounded-xl border border-flag-amber/20 bg-flag-amber-bg p-3 text-xs leading-5 text-flag-amber"
                    >
                      {warning.description}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-3 rounded-xl border border-flag-green/20 bg-flag-green-bg p-3 text-xs leading-5 text-flag-green">
                No outstanding eligibility warning is recorded for this request.
              </p>
            )}
            {booking.eligibilityOverrideReason ? (
              <div className="mt-4 rounded-xl border border-flag-amber/20 bg-flag-amber-bg p-3.5">
                <p className="text-[0.64rem] font-bold uppercase tracking-[0.13em] text-flag-amber">
                  Eligibility override
                </p>
                <p className="mt-1.5 text-xs leading-5 text-flag-amber">
                  {booking.eligibilityOverrideReason}
                </p>
                <p className="mt-1.5 text-[0.65rem] leading-4 text-ink-600">
                  This applied to this booking only. It did not verify your
                  profile for future requests.
                </p>
              </div>
            ) : null}
          </section>

          {booking.canCheckOut ? (
            <CheckoutForm bookingId={booking.id} />
          ) : null}

          {incidents.length > 0 ? (
            <section className="surface p-5">
              <p className="eyebrow">Incident status</p>
              <ul className="mt-3 space-y-2">
                {incidents.map((incident) => (
                  <li key={incident.id}>
                    <Link
                      href={`/app/incidents/${incident.id}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-sand-200 bg-sand-50 p-3 transition hover:border-brand-600/30 hover:bg-brand-50"
                    >
                      <div>
                        <p className="text-xs font-semibold text-ink-950">
                          {incident.categoryLabel}
                        </p>
                        <p className="mt-0.5 text-[0.65rem] text-ink-600">
                          {incident.statusLabel}
                        </p>
                      </div>
                      <svg
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden="true"
                        className="size-3.5 text-ink-600"
                      >
                        <path
                          d="M3.5 8h9M9 4.5 12.5 8 9 11.5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {canCancel ? (
            <CancelBookingForm
              bookingId={booking.id}
              status={booking.status as "pending" | "approved"}
            />
          ) : null}

          <section className="surface p-5">
            <p className="eyebrow">What happens next</p>
            <ol className="mt-4 space-y-3">
              {[
                [
                  "Manager review",
                  "Pending requests are reviewed in the room manager's queue.",
                ],
                [
                  "Access check",
                  "Phase 4 connects approval to a simulated, time-bound access decision.",
                ],
                [
                  "Close-out",
                  "Phase 5 records condition and incident outcomes.",
                ],
              ].map(([title, copy], index) => (
                <li key={title} className="flex gap-3">
                  <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-sand-100 font-mono text-[0.62rem] font-bold text-ink-700">
                    0{index + 1}
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-ink-950">{title}</p>
                    <p className="mt-0.5 text-[0.68rem] leading-5 text-ink-600">
                      {copy}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      {timeline ? (
        <LifecycleTimeline timeline={timeline} timezone={timezone} />
      ) : null}

      <p className="text-center text-[0.65rem] leading-5 text-ink-600/80">
        This receipt belongs to {profile.displayName}. Times are shown in{" "}
        {timezone}.
      </p>
    </div>
  );
}
