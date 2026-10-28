import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingStatusChip, StatusChip } from "@/components/badges";
import { DecisionPanel } from "@/components/manager/decision-panel";
import { LifecycleTimeline } from "@/components/timeline/lifecycle-timeline";
import { requireCurrentProfile } from "@/lib/auth/session";
import { getManagerRequest } from "@/lib/bookings/manager-queries";
import { getBookingTimeline } from "@/lib/bookings/timeline";
import { getCampusTimezone } from "@/lib/config";
import { getDatabase } from "@/lib/db/client";
import {
  formatCampusDate,
  formatCampusDateTime,
  formatCampusTime,
} from "@/lib/time/campus-time";

export const metadata: Metadata = {
  title: "Review request",
  description: "Review and decide a room request for an assigned room.",
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function actionLabel(action: string): string {
  switch (action) {
    case "booking.submitted":
      return "Request submitted";
    case "booking.approved":
      return "Request approved";
    case "booking.rejected":
      return "Request rejected";
    case "booking.cancelled":
      return "Booking cancelled";
    default:
      return action.replaceAll(".", " ");
  }
}

export default async function ManagerRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ decision?: string | string[] }>;
}) {
  const profile = await requireCurrentProfile();

  if (profile.role !== "manager" && profile.role !== "admin") {
    notFound();
  }

  const { id } = await params;
  const db = getDatabase();
  const request = getManagerRequest(db, profile, id);

  if (!request) {
    notFound();
  }

  const timeline = getBookingTimeline(db, profile, request.id);
  const query = await searchParams;
  const decisionResult = query.decision;
  const timezone = getCampusTimezone();
  const hoursByDay = WEEKDAYS.map((label, weekday) => ({
    label,
    hours: request.room.hours.filter((rule) => rule.weekday === weekday),
  })).filter((day) => day.hours.length > 0);

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-xs text-ink-600" aria-label="Breadcrumb">
        <Link href="/app/manager/queue" className="hover:text-ink-950">
          Manager queue
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-semibold text-ink-800">{request.id}</span>
      </nav>

      {decisionResult === "approved" || decisionResult === "rejected" ? (
        <section
          className={`rounded-2xl border p-5 ${
            decisionResult === "approved"
              ? "border-flag-green/20 bg-flag-green-bg text-flag-green"
              : "border-flag-amber/20 bg-flag-amber-bg text-flag-amber"
          }`}
        >
          <h2 className="text-lg font-bold">
            {decisionResult === "approved"
              ? "Request approved"
              : "Request not approved"}
          </h2>
          <p className="mt-1 text-sm leading-6">
            {decisionResult === "approved"
              ? "The room/time is now allocated. Approval does not itself confirm that a physical door was unlocked."
              : "The rejection was recorded with a requester-visible reason."}
          </p>
        </section>
      ) : null}

      <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <p className="eyebrow">Request review</p>
            <BookingStatusChip status={request.status} />
            {request.outstandingRequirementCount > 0 ? (
              <StatusChip tone="amber">Eligibility review</StatusChip>
            ) : null}
            {request.hasConfirmedConflict ? (
              <StatusChip tone="red">Confirmed conflict</StatusChip>
            ) : null}
          </div>
          <h1 className="mt-3 max-w-3xl font-display text-4xl leading-[1.03] tracking-[-0.04em] text-ink-950 sm:text-5xl">
            {request.roomName}
          </h1>
          <p className="mt-3 text-sm leading-6 text-ink-700">
            {request.building} · {request.location} · {request.roomCode}
          </p>
        </div>
        <Link href="/app/manager/queue" className="btn-secondary shrink-0">
          Back to queue
        </Link>
      </section>

      {request.hasConfirmedConflict ? (
        <div className="rounded-xl border border-flag-red/20 bg-flag-red-bg px-4 py-3 text-sm leading-5 text-flag-red">
          A confirmed booking now overlaps this request. Approval will be
          refused. You can reject the request with an explanation or leave it
          pending.
        </div>
      ) : null}

      {!request.requesterActive ? (
        <div className="rounded-xl border border-flag-amber/20 bg-flag-amber-bg px-4 py-3 text-sm leading-5 text-flag-amber">
          The requester account is inactive. This request cannot be approved.
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.85fr]">
        <div className="space-y-5">
          <section className="surface overflow-hidden">
            <div className="border-b border-sand-200 px-5 py-4">
              <p className="text-sm font-bold text-ink-950">Request details</p>
              <p className="mt-1 text-xs text-ink-600">
                Submitted {formatCampusDate(request.createdAt, timezone)} at{" "}
                {formatCampusTime(request.createdAt, timezone)}
              </p>
            </div>
            <dl className="divide-y divide-sand-200">
              {[
                ["Requester", request.requesterName],
                [
                  "Requested time",
                  formatCampusDateTime(request.startAt, request.endAt, timezone),
                ],
                ["Purpose", request.purpose],
                ["Group", request.groupName ?? "Not specified"],
                [
                  "Attendance",
                  `${request.expectedAttendance} / ${request.room.capacity} capacity`,
                ],
                ["Reference", request.id],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                >
                  <dt className="text-xs text-ink-600">{label}</dt>
                  <dd className="max-w-xl text-sm font-semibold text-ink-950 sm:text-right">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Eligibility · current state</p>
                <h2 className="mt-2 text-lg font-bold tracking-tight text-ink-950">
                  Requirements at decision time
                </h2>
              </div>
              <StatusChip
                tone={request.outstandingRequirementCount > 0 ? "amber" : "green"}
              >
                {request.outstandingRequirementCount > 0
                  ? `${request.outstandingRequirementCount} outstanding`
                  : "All verified"}
              </StatusChip>
            </div>
            {request.requirements.length > 0 ? (
              <ul className="mt-4 divide-y divide-sand-200">
                {request.requirements.map((requirement) => (
                  <li
                    key={requirement.id}
                    className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-sm font-semibold text-ink-900">
                        {requirement.description}
                      </p>
                      <p className="mt-1 font-mono text-[0.62rem] uppercase tracking-wide text-ink-600">
                        {requirement.requirementType.replaceAll("_", " ")}
                        {requirement.required ? " · required" : " · advisory"}
                      </p>
                    </div>
                    {requirement.verification === "verified" ? (
                      <StatusChip tone="green">Verified</StatusChip>
                    ) : requirement.verification === "expired" ? (
                      <StatusChip tone="red">Expired</StatusChip>
                    ) : (
                      <StatusChip tone="amber">Not verified</StatusChip>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 rounded-xl border border-sand-200 bg-sand-50 p-4 text-sm text-ink-600">
                No current eligibility requirements apply.
              </p>
            )}
            {request.snapshotWarnings.length > 0 ? (
              <div className="mt-4 border-t border-sand-200 pt-4">
                <p className="text-[0.64rem] font-bold uppercase tracking-[0.13em] text-ink-600">
                  At request time
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-ink-600">
                  {request.snapshotWarnings.map((warning) => (
                    <li key={warning.requirementId}>{warning.description}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          {request.overlaps.length > 0 ? (
            <section className="surface p-5">
              <p className="eyebrow">Pending overlaps</p>
              <h2 className="mt-2 text-lg font-bold tracking-tight text-ink-950">
                Other requests for this room/time
              </h2>
              <p className="mt-1 text-xs leading-5 text-ink-600">
                Pending requests do not reserve the room. Approving this request
                may make the others conflicting.
              </p>
              <ul className="mt-4 space-y-2">
                {request.overlaps.map((overlap) => (
                  <li key={overlap.id}>
                    <Link
                      href={`/app/manager/requests/${overlap.id}`}
                      className="flex flex-col justify-between gap-2 rounded-xl border border-sand-200 bg-sand-50 p-3.5 transition hover:border-brand-600/30 hover:bg-brand-50 sm:flex-row sm:items-center"
                    >
                      <div>
                        <p className="text-xs font-semibold text-ink-950">
                          {overlap.requesterName} · {overlap.groupName ?? "No group"}
                        </p>
                        <p className="mt-0.5 text-[0.68rem] text-ink-600">
                          {overlap.purpose}
                        </p>
                      </div>
                      <span className="shrink-0 text-[0.65rem] font-semibold text-ink-700">
                        {overlap.dateLabel} · {overlap.timeLabel}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {request.canDecide ? (
            <DecisionPanel
              bookingId={request.id}
              outstandingRequirements={request.outstandingRequirements.map(
                (requirement) => ({
                  id: requirement.id,
                  description: requirement.description,
                }),
              )}
            />
          ) : (
            <section className="surface p-5">
              <p className="eyebrow">Decision recorded</p>
              <h2 className="mt-2 text-lg font-bold tracking-tight text-ink-950">
                {request.status === "approved"
                  ? "Request approved"
                  : request.status === "rejected"
                    ? "Request not approved"
                    : request.status === "cancelled"
                      ? "Request cancelled"
                      : "No decision available"}
              </h2>
              {request.historicalDecision.reason ? (
                <dl className="mt-4 space-y-3 border-t border-sand-200 pt-4 text-sm">
                  <div>
                    <dt className="text-xs text-ink-600">Decision reason</dt>
                    <dd className="mt-1 leading-6 text-ink-800">
                      {request.historicalDecision.reason}
                    </dd>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-ink-600">
                    {request.historicalDecision.actorName ? (
                      <span>By {request.historicalDecision.actorName}</span>
                    ) : null}
                    {request.historicalDecision.decidedAt ? (
                      <span>
                        {formatCampusDate(
                          request.historicalDecision.decidedAt,
                          timezone,
                        )}{" "}
                        {formatCampusTime(
                          request.historicalDecision.decidedAt,
                          timezone,
                        )}
                      </span>
                    ) : null}
                  </div>
                </dl>
              ) : null}
              {request.cancellationReason ? (
                <div className="mt-4 rounded-xl border border-sand-200 bg-sand-50 p-4">
                  <p className="text-[0.64rem] font-bold uppercase tracking-[0.13em] text-ink-600">
                    Cancellation reason
                  </p>
                  <p className="mt-1 text-sm leading-6 text-ink-800">
                    {request.cancellationReason}
                  </p>
                </div>
              ) : null}
            </section>
          )}
        </div>

        <div className="space-y-5">
          <section className="surface p-5">
            <p className="eyebrow">Room context</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusChip
                tone={request.room.status === "active" ? "green" : "red"}
              >
                {request.room.status === "active" ? "Room active" : "Room inactive"}
              </StatusChip>
              <StatusChip
                tone={request.room.requestsEnabled ? "green" : "neutral"}
              >
                {request.room.requestsEnabled
                  ? "Requests open"
                  : "Requests disabled"}
              </StatusChip>
            </div>
            <p className="mt-4 text-sm leading-6 text-ink-700">
              {request.room.policySummary}
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {request.room.facilities.map((facility) => (
                <span
                  key={facility}
                  className="rounded-md border border-sand-200 bg-sand-50 px-2 py-1 text-[0.66rem] text-ink-700"
                >
                  {facility}
                </span>
              ))}
            </div>
            <dl className="mt-4 space-y-2.5 border-t border-sand-200 pt-4 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-600">Capacity</dt>
                <dd className="font-semibold text-ink-950">
                  {request.room.capacity}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-600">Time increment</dt>
                <dd className="font-semibold text-ink-950">
                  {request.room.policy.slotIntervalMinutes} min
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-600">Maximum duration</dt>
                <dd className="font-semibold text-ink-950">
                  {request.room.policy.maximumDurationMinutes} min
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-600">Buffer</dt>
                <dd className="font-semibold text-ink-950">
                  {request.room.policy.bufferMinutes} min
                </dd>
              </div>
            </dl>
            {!request.startInFuture && request.status === "pending" ? (
              <p className="mt-4 rounded-xl border border-flag-amber/20 bg-flag-amber-bg p-3 text-xs leading-5 text-flag-amber">
                The requested start time has passed. Approval is no longer
                possible; the request can be rejected.
              </p>
            ) : null}
          </section>

          <section className="surface p-5">
            <p className="eyebrow">Weekly hours</p>
            <dl className="mt-3 space-y-2">
              {hoursByDay.map((day) => (
                <div
                  key={day.label}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <dt className="text-ink-600">{day.label}</dt>
                  <dd className="font-mono text-[0.65rem] font-semibold text-ink-950">
                    {day.hours
                      .map((hour) => `${hour.opensAt}–${hour.closesAt}`)
                      .filter((value, index, list) => list.indexOf(value) === index)
                      .join(", ")}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="surface p-5">
            <p className="eyebrow">Request history</p>
            <ol className="mt-4 space-y-3">
              {request.history.length > 0 ? (
                request.history.map((event) => (
                  <li key={event.id} className="border-l border-sand-300 pl-3">
                    <p className="text-xs font-semibold text-ink-900">
                      {actionLabel(event.action)}
                    </p>
                    <p className="mt-0.5 text-[0.65rem] leading-4 text-ink-600">
                      {formatCampusDate(event.occurredAt, timezone)}{" "}
                      {formatCampusTime(event.occurredAt, timezone)}
                      {event.actorName ? ` · ${event.actorName}` : ""}
                    </p>
                  </li>
                ))
              ) : (
                <p className="text-xs text-ink-600">No history events yet.</p>
              )}
            </ol>
          </section>
        </div>
      </div>

      {timeline ? (
        <LifecycleTimeline timeline={timeline} timezone={timezone} />
      ) : null}
    </div>
  );
}