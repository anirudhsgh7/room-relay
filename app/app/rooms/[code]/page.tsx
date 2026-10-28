import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusChip } from "@/components/badges";
import { requireCurrentProfile } from "@/lib/auth/session";
import { getDatabase } from "@/lib/db/client";
import { canRequestRoom, getRoomDetail } from "@/lib/rooms/queries";
import { parseRoomSearchParams, toRoomSearchQuery } from "@/lib/rooms/search";
import type { RoomAvailabilityCode, RoomHours } from "@/lib/rooms/types";

export const metadata: Metadata = {
  title: "Room details",
  description: "Review room rules, requirements, and availability.",
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

function hoursLabel(hours: RoomHours[]) {
  if (hours.length === 0) {
    return "No active booking hours";
  }

  return hours
    .map((rule) => `${rule.opensAt}–${rule.closesAt}`)
    .filter((value, index, list) => list.indexOf(value) === index)
    .join(", ");
}

function availabilityBanner(code: RoomAvailabilityCode) {
  switch (code) {
    case "available":
      return {
        tone: "green" as const,
        title: "This time looks requestable",
        copy: "Submit a request for manager review. This is not approval to enter.",
      };
    case "conflict":
      return {
        tone: "red" as const,
        title: "This time is not available",
        copy: "A confirmed booking already holds this room. Choose another time or room.",
      };
    case "outside_hours":
      return {
        tone: "amber" as const,
        title: "Outside this room's hours",
        copy: "Check the weekly hours below, or search for another time.",
      };
    case "invalid_time":
      return {
        tone: "amber" as const,
        title: "This time does not meet the room rules",
        copy: "Use the room's time increment and maximum duration, then try again.",
      };
    case "not_requestable":
      return {
        tone: "neutral" as const,
        title: "This room is not accepting requests",
        copy: "You can still review the room and its policy, but request submission is disabled.",
      };
  }
}

export default async function RoomDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireCurrentProfile();
  const { code } = await params;
  const rawParams = await searchParams;
  const parsed = parseRoomSearchParams(rawParams);
  const interval = parsed.ok ? parsed.interval : null;
  const room = getRoomDetail(getDatabase(), profile, code, interval);

  if (!room) {
    notFound();
  }

  const requestQuery = parsed.ok
    ? toRoomSearchQuery(parsed.values).toString()
    : "";
  const canRequest = canRequestRoom(profile, room);
  const requiredRequirements = room.requirements.filter(
    (requirement) => requirement.required,
  );
  const unverifiedRequired =
    profile.role === "student"
      ? requiredRequirements.filter(
          (requirement) =>
            requirement.verification !== "verified" &&
            requirement.verification !== null,
        )
      : [];
  const hoursByDay = WEEKDAYS.map((label, weekday) => ({
    label,
    hours: room.hours.filter((rule) => rule.weekday === weekday),
  })).filter((day) => day.hours.length > 0);

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-xs text-ink-600" aria-label="Breadcrumb">
        <Link href="/app/rooms" className="hover:text-ink-950">
          Room discovery
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-semibold text-ink-800">{room.code}</span>
      </nav>

      <section className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <p className="eyebrow">Room details</p>
            <StatusChip tone="neutral">{room.code}</StatusChip>
            {requiredRequirements.length > 0 ? (
              profile.role === "student" ? (
                unverifiedRequired.length > 0 ? (
                  <StatusChip tone="amber">Eligibility review needed</StatusChip>
                ) : (
                  <StatusChip tone="green">Requirements verified</StatusChip>
                )
              ) : (
                <StatusChip tone="neutral">
                  {requiredRequirements.length} student requirement
                  {requiredRequirements.length === 1 ? "" : "s"}
                </StatusChip>
              )
            ) : null}
          </div>
          <h1 className="mt-3 max-w-3xl font-display text-4xl leading-[1.02] tracking-[-0.04em] text-ink-950 sm:text-5xl">
            {room.name}
          </h1>
          <p className="mt-3 text-sm leading-6 text-ink-700">
            {room.building} · {room.location}
          </p>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          {canRequest ? (
            <Link
              href={`/app/rooms/${encodeURIComponent(room.code)}/request${
                requestQuery ? `?${requestQuery}` : ""
              }`}
              className="btn-primary"
            >
              Request this room
              <svg
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
                className="size-4"
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
          ) : (
            <span className="rounded-full border border-sand-200 bg-white px-4 py-2 text-xs font-semibold text-ink-600">
              {room.policy.requestsEnabled
                ? "Student requests only"
                : "Not accepting requests"}
            </span>
          )}
          <Link
            href="/app/rooms"
            className="text-center text-xs font-semibold text-ink-600 hover:text-ink-950"
          >
            Back to discovery
          </Link>
        </div>
      </section>

      {parsed.ok && interval && room.availability ? (
        <section className="surface p-4 sm:p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                {room.availability === "available" ? (
                  <StatusChip tone="green">Available for request</StatusChip>
                ) : room.availability === "conflict" ? (
                  <StatusChip tone="red">Unavailable</StatusChip>
                ) : room.availability === "outside_hours" ? (
                  <StatusChip tone="amber">Outside hours</StatusChip>
                ) : room.availability === "invalid_time" ? (
                  <StatusChip tone="amber">Check time rules</StatusChip>
                ) : (
                  <StatusChip tone="neutral">Not requestable</StatusChip>
                )}
                <p className="text-sm font-semibold text-ink-950">
                  {interval.dateLabel} · {interval.startLabel}–
                  {interval.endLabel}
                </p>
              </div>
              <p className="mt-2 text-xs leading-5 text-ink-600">
                {availabilityBanner(room.availability).copy}
              </p>
            </div>
            <Link
              href={`/app/rooms?${toRoomSearchQuery({
                date: interval.date,
                startTime: interval.startLabel,
                endTime: interval.endLabel,
              }).toString()}`}
              className="btn-secondary min-h-9 px-3.5 py-1.5 text-xs"
            >
              Check another time
            </Link>
          </div>
        </section>
      ) : !parsed.ok ? (
        <div
          role="alert"
          className="rounded-xl border border-flag-amber/20 bg-flag-amber-bg px-4 py-3 text-sm text-flag-amber"
        >
          {parsed.error}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="space-y-5">
          <section className="surface p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="eyebrow">Room profile</p>
                <h2 className="mt-2 text-lg font-bold tracking-tight text-ink-950">
                  Space and facilities
                </h2>
              </div>
              <span className="rounded-full bg-sand-100 px-3 py-1.5 text-xs font-bold text-ink-800">
                Capacity {room.capacity}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-ink-700">
              {room.policySummary}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {room.facilities.map((facility) => (
                <span
                  key={facility}
                  className="rounded-lg border border-sand-200 bg-sand-50 px-3 py-1.5 text-xs font-medium text-ink-700"
                >
                  {facility}
                </span>
              ))}
            </div>
          </section>

          <section className="surface p-5 sm:p-6">
            <p className="eyebrow">Booking policy</p>
            <h2 className="mt-2 text-lg font-bold tracking-tight text-ink-950">
              What this request will follow
            </h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {[
                {
                  label: "Time increment",
                  value: `${room.policy.slotIntervalMinutes} minutes`,
                },
                {
                  label: "Minimum notice",
                  value: `${room.policy.minimumNoticeMinutes} minutes`,
                },
                {
                  label: "Maximum duration",
                  value: `${room.policy.maximumDurationMinutes} minutes`,
                },
                {
                  label: "Turnaround buffer",
                  value:
                    room.policy.bufferMinutes === 0
                      ? "None"
                      : `${room.policy.bufferMinutes} minutes`,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-sand-200 bg-sand-50 p-3.5"
                >
                  <p className="text-[0.64rem] font-bold uppercase tracking-[0.13em] text-ink-600">
                    {item.label}
                  </p>
                  <p className="mt-1.5 text-sm font-semibold text-ink-950">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[0.68rem] leading-4 text-ink-600">
              These are illustrative demo policies. A manager still reviews every
              request before it becomes approved.
            </p>
          </section>

          <section className="surface p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Eligibility</p>
                <h2 className="mt-2 text-lg font-bold tracking-tight text-ink-950">
                  Requirements for this room
                </h2>
              </div>
              <span className="text-xs font-semibold text-ink-600">
                {requiredRequirements.length} required
              </span>
            </div>
            {room.requirements.length > 0 ? (
              <ul className="mt-4 divide-y divide-sand-200">
                {room.requirements.map((requirement) => (
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
                    {profile.role === "student" ? (
                      requirement.verification === "verified" ? (
                        <StatusChip tone="green">Verified</StatusChip>
                      ) : requirement.verification === "expired" ? (
                        <StatusChip tone="red">Expired</StatusChip>
                      ) : (
                        <StatusChip tone="amber">Not verified</StatusChip>
                      )
                    ) : (
                      <StatusChip tone="neutral">Student eligibility</StatusChip>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 rounded-xl border border-sand-200 bg-sand-50 p-4 text-sm text-ink-600">
                This room has no additional eligibility requirements in the
                demo policy.
              </p>
            )}
            {unverifiedRequired.length > 0 && canRequest ? (
              <div className="mt-4 rounded-xl border border-flag-amber/20 bg-flag-amber-bg p-4 text-xs leading-5 text-flag-amber">
                You may submit a request, but a manager must review this
                requirement before approval. The request remains pending.
              </div>
            ) : null}
          </section>
        </div>

        <div className="space-y-5">
          <section className="surface p-5">
            <p className="eyebrow">Weekly hours</p>
            <h2 className="mt-2 text-lg font-bold tracking-tight text-ink-950">
              Campus-local opening times
            </h2>
            <dl className="mt-4 space-y-2.5">
              {hoursByDay.length > 0 ? (
                hoursByDay.map((day) => (
                  <div
                    key={day.label}
                    className="flex items-center justify-between gap-4 border-b border-sand-200 pb-2.5 last:border-0 last:pb-0"
                  >
                    <dt className="text-xs font-medium text-ink-600">
                      {day.label}
                    </dt>
                    <dd className="font-mono text-[0.68rem] font-semibold text-ink-950">
                      {hoursLabel(day.hours)}
                    </dd>
                  </div>
                ))
              ) : (
                <p className="text-sm text-ink-600">No active room hours.</p>
              )}
            </dl>
          </section>

          <section className="relative overflow-hidden rounded-2xl bg-ink-950 p-5 text-white">
            <div className="grid-paper pointer-events-none absolute inset-0 opacity-70" />
            <div className="relative">
              <p className="label text-brand-300">Request status</p>
              <h2 className="mt-3 font-display text-2xl leading-tight tracking-[-0.03em]">
                Pending is not permission.
              </h2>
              <p className="mt-3 text-xs leading-5 text-white/55">
                A submitted request goes to the room manager. Entering the room
                is only authorized after approval and a successful access check
                in a later phase.
              </p>
              {canRequest ? (
                <Link
                  href={`/app/rooms/${encodeURIComponent(room.code)}/request${
                    requestQuery ? `?${requestQuery}` : ""
                  }`}
                  className="btn-primary mt-5 w-full"
                >
                  Continue to request
                </Link>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
