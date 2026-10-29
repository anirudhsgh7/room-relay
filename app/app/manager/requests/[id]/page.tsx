import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingStatusChip, StatusChip } from "@/components/badges";
import { DecisionPanel } from "@/components/manager/decision-panel";
import { StaffCancelForm } from "@/components/manager/staff-cancel-form";
import { getAllocationStanding } from "@/lib/allocation/ranking";
import { ALLOCATION_RULE_COPY, describePolicy } from "@/lib/rooms/policy";
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
    case "booking.waitlist_joined":
      return "Joined the waitlist";
    case "booking.approved":
      return "Approved";
    case "booking.rejected":
      return "Declined";
    case "booking.cancelled":
      return "Cancelled";
    case "booking.waitlisted":
      return "Moved to the waitlist";
    case "booking.promoted":
      return "Back in review from the waitlist";
    case "booking.completed":
      return "Completed";
    default:
      return action.replace(/^booking\./, "").replaceAll("_", " ");
  }
}

export default async function ManagerRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    decision?: string | string[];
    waitlisted?: string | string[];
    declined?: string | string[];
    cancelled?: string | string[];
    promoted?: string | string[];
  }>;
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
  const movedToWaitlist = Number(query.waitlisted ?? 0) || 0;
  const autoDeclined = Number(query.declined ?? 0) || 0;
  const promoted = Number(query.promoted ?? 0) || 0;
  const standing =
    request.status === "pending" || request.status === "waitlisted"
      ? getAllocationStanding(db, request.id, [request.status])
      : null;
  const rule = ALLOCATION_RULE_COPY[request.room.policy.allocationRule];
  const timezone = getCampusTimezone();
  const hoursByDay = WEEKDAYS.map((label, weekday) => ({
    label,
    hours: request.room.hours.filter((rule) => rule.weekday === weekday),
  })).filter((day) => day.hours.length > 0);

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-xs text-ink-600" aria-label="Breadcrumb">
        <Link href="/app/manager/queue" className="hover:text-ink-950">
          Requests to review
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-semibold text-ink-800">{request.requesterName}</span>
      </nav>

      {decisionResult === "approved" || decisionResult === "rejected" ? (
        <section
          role="status"
          className={`rounded-2xl border p-5 ${
            decisionResult === "approved"
              ? "border-flag-green/20 bg-flag-green-bg text-flag-green"
              : "border-sand-300 bg-sand-100 text-ink-800"
          }`}
        >
          <h2 className="text-lg font-bold">
            {decisionResult === "approved" ? "Approved" : "Declined"}
          </h2>
          <p className="mt-1 text-sm leading-6">
            {decisionResult === "approved"
              ? `${request.requesterName} has been notified.${
                  movedToWaitlist > 0
                    ? ` ${movedToWaitlist} competing ${
                        movedToWaitlist === 1 ? "request was" : "requests were"
                      } moved to the waitlist, and each requester was told their place.`
                    : autoDeclined > 0
                      ? ` ${autoDeclined} competing ${
                          autoDeclined === 1 ? "request was" : "requests were"
                        } declined because this room keeps no waitlist.`
                      : ""
                }`
              : `${request.requesterName} has been notified with your reason.`}
          </p>
        </section>
      ) : null}

      {query.cancelled === "1" ? (
        <section role="status" className="rounded-2xl border border-sand-300 bg-sand-100 p-5 text-ink-800">
          <h2 className="text-lg font-bold">Cancelled</h2>
          <p className="mt-1 text-sm leading-6">
            {request.requesterName} has been notified with your reason.
            {promoted > 0
              ? ` ${promoted} waitlisted ${promoted === 1 ? "request is" : "requests are"} now back in your review queue.`
              : ""}
          </p>
        </section>
      ) : null}

      <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <BookingStatusChip status={request.status} />
            {request.outstandingRequirementCount > 0 ? (
              <StatusChip tone="amber">Requirements not met yet</StatusChip>
            ) : null}
            {request.hasConfirmedConflict && request.status === "pending" ? (
              <StatusChip tone="red">Time already booked</StatusChip>
            ) : null}
          </div>
          <h1 className="mt-3 max-w-3xl font-display text-4xl leading-[1.05] tracking-[-0.03em] text-ink-950 sm:text-5xl">
            {request.requesterName} for {request.roomName}
          </h1>
          <p className="mt-3 text-base leading-7 text-ink-800">
            {formatCampusDateTime(request.startAt, request.endAt, timezone)}
          </p>
        </div>
        <Link href="/app/manager/queue" className="btn-secondary shrink-0">
          Back to requests
        </Link>
      </section>

      {request.hasConfirmedConflict && request.status === "pending" ? (
        <div className="rounded-xl border border-flag-red/20 bg-flag-red-bg px-4 py-3 text-sm leading-6 text-flag-red">
          Another booking already holds this time, so it cannot be approved.
          Decline it with a reason, or leave it and it will close when its time
          passes.
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
              <h2 className="text-base font-bold text-ink-950">Request details</h2>
              <p className="mt-1 text-sm text-ink-600">
                Sent {formatCampusDate(request.createdAt, timezone)} at{" "}
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
                <h2 className="text-base font-bold tracking-tight text-ink-950">
                  Room requirements
                </h2>
                <p className="mt-1 text-sm text-ink-600">
                  Checked against {request.requesterName}&apos;s record now.
                </p>
              </div>
              <StatusChip
                tone={request.outstandingRequirementCount > 0 ? "amber" : "green"}
              >
                {request.outstandingRequirementCount > 0
                  ? `${request.outstandingRequirementCount} not met`
                  : "All met"}
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
                      <p className="mt-1 text-xs text-ink-600">
                        {requirement.required ? "Required" : "Recommended"}
                      </p>
                    </div>
                    {requirement.verification === "verified" ? (
                      <StatusChip tone="green">Met</StatusChip>
                    ) : requirement.verification === "expired" ? (
                      <StatusChip tone="red">Expired</StatusChip>
                    ) : (
                      <StatusChip tone="amber">Not met</StatusChip>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 rounded-xl border border-sand-200 bg-sand-50 p-4 text-sm text-ink-600">
                This room has no special requirements.
              </p>
            )}
            {request.snapshotWarnings.length > 0 ? (
              <div className="mt-4 border-t border-sand-200 pt-4">
                <p className="text-sm font-semibold text-ink-700">
                  Not met when the request was sent
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-ink-600">
                  {request.snapshotWarnings.map((warning) => (
                    <li key={warning.requirementId}>{warning.description}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          {standing && standing.total > 1 ? (
            <section className="surface p-5" aria-labelledby="line-heading">
              <h2 id="line-heading" className="text-base font-bold text-ink-950">
                {request.status === "waitlisted"
                  ? `Number ${standing.position} of ${standing.total} on the waitlist`
                  : standing.position === 1
                    ? `First in line of ${standing.total} requests for this time`
                    : `Number ${standing.position} of ${standing.total} requests for this time`}
              </h2>
              <p className="mt-1 text-sm leading-6 text-ink-600">
                {request.roomName} uses &ldquo;{rule.label}&rdquo;: {rule.short.toLowerCase()}{" "}
                Approving one moves the others to the waitlist.
              </p>
              <ol className="mt-4 space-y-2">
                {[
                  ...standing.ahead.map((item) => ({ ...item, place: "ahead" as const })),
                  ...standing.behind.map((item) => ({ ...item, place: "behind" as const })),
                ].map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/app/manager/requests/${item.id}`}
                      className="flex flex-col justify-between gap-1 rounded-xl border border-sand-200 bg-sand-50 p-3.5 transition hover:border-brand-600/30 hover:bg-brand-50 sm:flex-row sm:items-center sm:gap-4"
                    >
                      <span>
                        <span className="block text-sm font-semibold text-ink-950">
                          {item.requesterName}
                          {item.groupName ? ` · ${item.groupName}` : ""}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-600">
                          {formatCampusDateTime(item.startAt, item.endAt, timezone)} ·{" "}
                          {item.expectedAttendance} people
                        </span>
                      </span>
                      <span
                        className={`shrink-0 text-xs font-semibold ${
                          item.place === "ahead" ? "text-flag-amber" : "text-ink-600"
                        }`}
                      >
                        {item.place === "ahead" ? "Ahead: " : "Behind: "}
                        {item.place === "ahead" ? item.comparison : `this one is ${item.comparison}`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
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
              outranking={(standing?.ahead ?? []).map((item) => ({
                id: item.id,
                requesterName: item.requesterName,
                timeLabel: formatCampusDateTime(item.startAt, item.endAt, timezone),
                comparison: item.comparison,
              }))}
              ruleLabel={rule.label}
            />
          ) : (
            <section className="surface p-5">
              <h2 className="text-lg font-bold tracking-tight text-ink-950">
                {request.status === "approved"
                  ? "Approved"
                  : request.status === "rejected"
                    ? "Declined"
                    : request.status === "cancelled"
                      ? "Cancelled"
                      : request.status === "waitlisted"
                        ? "On the waitlist"
                        : request.status === "checked_in"
                          ? "In use now"
                          : request.status === "completed"
                            ? "Completed"
                            : request.status === "incident"
                              ? "Completed with a reported issue"
                              : "No decision"}
              </h2>
              {request.status === "waitlisted" ? (
                <p className="mt-2 text-sm leading-6 text-ink-700">
                  Another booking holds this time. If it is cancelled or ends
                  early, this request returns to your queue automatically.
                </p>
              ) : null}
              {request.allocationExceptionReason ? (
                <div className="mt-4 rounded-xl border border-flag-amber/20 bg-flag-amber-bg p-4">
                  <p className="text-sm font-semibold text-flag-amber">Approved out of order</p>
                  <p className="mt-1 text-sm leading-6 text-ink-800">
                    {request.allocationExceptionReason}
                  </p>
                </div>
              ) : null}
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
                  <p className="text-sm font-semibold text-ink-700">
                    Cancellation reason
                  </p>
                  <p className="mt-1 text-sm leading-6 text-ink-800">
                    {request.cancellationReason}
                  </p>
                </div>
              ) : null}
            </section>
          )}

          {(request.status === "approved" && request.startInFuture) ||
          request.status === "waitlisted" ? (
            <StaffCancelForm
              bookingId={request.id}
              status={request.status}
              requesterName={request.requesterName}
            />
          ) : null}
        </div>

        <div className="space-y-5">
          <section className="surface p-5">
            <h2 className="text-base font-bold text-ink-950">{request.roomName}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusChip
                tone={request.room.status === "active" ? "green" : "red"}
              >
                {request.room.status === "active" ? "Open" : "Closed"}
              </StatusChip>
              <StatusChip
                tone={request.room.requestsEnabled ? "green" : "neutral"}
              >
                {request.room.requestsEnabled
                  ? "Taking requests"
                  : "Not taking requests"}
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
            <dl className="mt-4 space-y-2.5 border-t border-sand-200 pt-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-600">Seats</dt>
                <dd className="font-semibold text-ink-950">{request.room.capacity}</dd>
              </div>
              {describePolicy(request.room.policy).map((line) => (
                <div key={line.label} className="flex items-start justify-between gap-3">
                  <dt className="text-ink-600">{line.label}</dt>
                  <dd className="text-right font-semibold text-ink-950">{line.value}</dd>
                </div>
              ))}
              <div className="flex items-start justify-between gap-3">
                <dt className="text-ink-600">Competing requests</dt>
                <dd className="text-right font-semibold text-ink-950">{rule.label}</dd>
              </div>
            </dl>
            <Link
              href={`/app/admin/rooms/${request.roomId}`}
              className="mt-4 inline-flex text-sm font-semibold text-brand-700 hover:text-brand-600"
            >
              Room hours, closures, and rules
            </Link>
            {!request.startInFuture && request.status === "pending" ? (
              <p className="mt-4 rounded-xl border border-flag-amber/20 bg-flag-amber-bg p-3 text-xs leading-5 text-flag-amber">
                The start time has passed, so this can no longer be approved.
                Decline it to close it.
              </p>
            ) : null}
          </section>

          <section className="surface p-5">
            <h2 className="text-base font-bold text-ink-950">Opening hours</h2>
            <dl className="mt-3 space-y-2">
              {hoursByDay.map((day) => (
                <div
                  key={day.label}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <dt className="text-ink-600">{day.label}</dt>
                  <dd className="text-sm font-semibold tabular-nums text-ink-950">
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
            <h2 className="text-base font-bold text-ink-950">History</h2>
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