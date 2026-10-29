import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusChip } from "@/components/badges";
import {
  IncidentResolveForm,
  IncidentReviewForm,
} from "@/components/incidents/incident-forms";
import { LifecycleTimeline } from "@/components/timeline/lifecycle-timeline";
import { requireCurrentProfile } from "@/lib/auth/session";
import { getBookingTimeline } from "@/lib/bookings/timeline";
import { getCampusTimezone } from "@/lib/config";
import { getDatabase } from "@/lib/db/client";
import {
  getIncidentDetail,
  type IncidentDetail,
} from "@/lib/incidents/queries";
import {
  formatCampusDate,
  formatCampusTime,
  formatCampusTimeRange,
} from "@/lib/time/campus-time";

export const metadata: Metadata = {
  title: "Incident detail",
  description: "Review a room condition incident.",
};

function incidentTone(status: IncidentDetail["status"]) {
  return status === "open" ? "red" : status === "reviewing" ? "amber" : "green";
}

export default async function IncidentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ updated?: string | string[] }>;
}) {
  const profile = await requireCurrentProfile();
  const { id } = await params;
  const query = await searchParams;
  const db = getDatabase();
  const incident = getIncidentDetail(db, profile, id);

  if (!incident) {
    notFound();
  }

  const timeline = getBookingTimeline(db, profile, incident.bookingId);
  const timezone = getCampusTimezone();
  const requestedBookingHref =
    profile.role === "student"
      ? `/app/bookings/${incident.bookingId}`
      : `/app/manager/requests/${incident.bookingId}`;
  const updated =
    query.updated === "reviewing" || query.updated === "resolved"
      ? query.updated
      : null;

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-xs text-ink-600" aria-label="Breadcrumb">
        <Link
          href={profile.role === "student" ? "/app/bookings" : "/app/incidents"}
          className="hover:text-ink-950"
        >
          {profile.role === "student" ? "My requests" : "Incidents"}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-semibold text-ink-800">{incident.id}</span>
      </nav>

      {updated ? (
        <section
          className={`rounded-2xl border p-5 ${
            updated === "resolved"
              ? "border-flag-green/20 bg-flag-green-bg text-flag-green"
              : "border-flag-amber/20 bg-flag-amber-bg text-flag-amber"
          }`}
        >
          <h2 className="text-lg font-bold">
            {updated === "resolved"
              ? "Incident resolved"
              : "Incident moved into review"}
          </h2>
          <p className="mt-1 text-sm leading-6">
            {updated === "resolved"
              ? "The final operational resolution was recorded. No automatic penalty was applied."
              : "The manager review note was recorded. Final resolution remains with an administrator."}
          </p>
        </section>
      ) : null}

      <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <p className="eyebrow">Incident review</p>
            <StatusChip tone={incidentTone(incident.status)}>
              {incident.statusLabel}
            </StatusChip>
            <StatusChip tone="neutral">{incident.categoryLabel}</StatusChip>
          </div>
          <h1 className="mt-3 max-w-3xl font-display text-4xl leading-[1.03] tracking-[-0.04em] text-ink-950 sm:text-5xl">
            {incident.roomName}
          </h1>
          <p className="mt-3 text-sm leading-6 text-ink-700">
            {incident.building} · {incident.roomCode} · Reported by{" "}
            {incident.reporterName}
          </p>
        </div>
        <Link href={requestedBookingHref} className="btn-secondary shrink-0">
          View booking
        </Link>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.85fr]">
        <div className="space-y-5">
          <section className="surface p-5">
            <p className="eyebrow">Reported issue</p>
            <h2 className="mt-2 text-lg font-bold tracking-tight text-ink-950">
              {incident.categoryLabel}
            </h2>
            <p className="mt-3 text-sm leading-6 text-ink-700">
              {incident.description}
            </p>
            <p className="mt-3 text-[0.65rem] text-ink-600">
              Reported {formatCampusDate(incident.createdAt, timezone)} at{" "}
              {formatCampusTime(incident.createdAt, timezone)}
            </p>
          </section>

          <section className="surface p-5">
            <p className="eyebrow">Booking context</p>
            <dl className="mt-3 space-y-3 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-600">Requester</dt>
                <dd className="font-semibold text-ink-950">
                  {incident.requesterName}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-600">Requested interval</dt>
                <dd className="text-right font-semibold text-ink-950">
                  {formatCampusDate(incident.bookingStartAt, timezone)} ·{" "}
                  {formatCampusTimeRange(
                    incident.bookingStartAt,
                    incident.bookingEndAt,
                    timezone,
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-600">Booking status</dt>
                <dd className="font-semibold capitalize text-ink-950">
                  {incident.bookingStatus.replaceAll("_", " ")}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-600">Purpose</dt>
                <dd className="max-w-[16rem] text-right font-semibold text-ink-950">
                  {incident.purpose}
                </dd>
              </div>
            </dl>
          </section>

          {incident.conditionReport ? (
            <section className="surface p-5">
              <p className="eyebrow">Check-out condition report</p>
              <StatusChip
                tone={
                  incident.conditionReport.conditionState === "issue_found"
                    ? "amber"
                    : "green"
                }
              >
                {incident.conditionReport.conditionState === "issue_found"
                  ? "Issue found"
                  : "Left as found"}
              </StatusChip>
              <p className="mt-3 text-sm leading-6 text-ink-700">
                {incident.conditionReport.notes}
              </p>
              <p className="mt-2 text-[0.65rem] text-ink-600">
                {formatCampusDate(incident.conditionReport.createdAt, timezone)}{" "}
                {formatCampusTime(incident.conditionReport.createdAt, timezone)}
              </p>
            </section>
          ) : null}

          {incident.managerReviewNote ? (
            <section className="surface p-5">
              <p className="eyebrow">Manager review</p>
              <p className="mt-2 text-sm leading-6 text-ink-700">
                {incident.managerReviewNote}
              </p>
              <p className="mt-2 text-[0.65rem] text-ink-600">
                {incident.managerReviewedByName ?? "Manager"}
                {incident.managerReviewedAt
                  ? ` · ${formatCampusDate(
                      incident.managerReviewedAt,
                      timezone,
                    )} ${formatCampusTime(incident.managerReviewedAt, timezone)}`
                  : ""}
              </p>
            </section>
          ) : null}

          {incident.resolutionNote ? (
            <section className="surface p-5">
              <p className="eyebrow">Final admin resolution</p>
              <p className="mt-2 text-sm leading-6 text-ink-700">
                {incident.resolutionNote}
              </p>
              <p className="mt-2 text-[0.65rem] text-ink-600">
                {incident.resolvedByName ?? "Administrator"}
                {incident.resolvedAt
                  ? ` · ${formatCampusDate(
                      incident.resolvedAt,
                      timezone,
                    )} ${formatCampusTime(incident.resolvedAt, timezone)}`
                  : ""}
              </p>
            </section>
          ) : null}

          {incident.canReview ? (
            <section className="surface p-5">
              <p className="text-sm font-bold text-ink-950">
                Manager review / recommendation
              </p>
              <p className="mt-1 mb-3 text-xs leading-5 text-ink-600">
                Record the facts and recommendation. This does not resolve the
                incident or impose a penalty.
              </p>
              <IncidentReviewForm incidentId={incident.id} />
            </section>
          ) : null}

          {incident.canResolve ? (
            <section className="surface p-5">
              <p className="text-sm font-bold text-ink-950">
                Administrator final resolution
              </p>
              <p className="mt-1 mb-3 text-xs leading-5 text-ink-600">
                This closes the incident and may complete the booking. No
                automatic sanction is created.
              </p>
              <IncidentResolveForm incidentId={incident.id} />
            </section>
          ) : null}

          {incident.status === "reviewing" &&
          profile.role === "manager" &&
          !incident.canResolve ? (
            <p className="rounded-xl border border-sand-200 bg-sand-50 p-4 text-xs leading-5 text-ink-600">
              Waiting for an administrator to record the outcome. Managers
              recommend; they don&apos;t decide sanctions.
            </p>
          ) : null}
        </div>

        <div className="space-y-5">
          {timeline ? <LifecycleTimeline timeline={timeline} timezone={timezone} /> : null}
          <section className="relative overflow-hidden rounded-2xl bg-ink-950 p-5 text-white">
            <div className="grid-paper pointer-events-none absolute inset-0 opacity-70" />
            <div className="relative">
              <p className="label text-brand-300">Human review</p>
              <h2 className="mt-3 font-display text-2xl leading-tight tracking-[-0.03em]">
                No automatic penalties.
              </h2>
              <p className="mt-3 text-xs leading-5 text-white/55">
                The report is an observation, not a finding of blame. A manager
                can document a recommendation; an administrator records the final
                operational resolution.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
