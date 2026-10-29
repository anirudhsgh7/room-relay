import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusChip } from "@/components/badges";
import { requireCurrentProfile } from "@/lib/auth/session";
import { getDatabase } from "@/lib/db/client";
import { canRequestRoom, getRoomDetail } from "@/lib/rooms/queries";
import { parseRoomSearchParams, toRoomSearchQuery } from "@/lib/rooms/search";
import { blackoutLabel } from "@/lib/admin/rooms";
import { ALLOCATION_RULE_COPY, describePolicy } from "@/lib/rooms/policy";
import type { RoomAvailabilityCode, RoomHours } from "@/lib/rooms/types";

export const metadata: Metadata = {
  title: "Room",
  description: "Room details, opening hours, booking rules, and availability.",
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
        title: "Free at this time",
        copy: "Send a request and the room manager will approve or decline it.",
      };
    case "conflict":
      return {
        tone: "red" as const,
        title: "Already booked at this time",
        copy: "Choose another time or room, or join the waitlist if this room offers one.",
      };
    case "blackout":
      return {
        tone: "red" as const,
        title: "The room is closed at this time",
        copy: "This time falls inside a planned closure. Choose another time or room.",
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
        title: "This time doesn't fit the room's rules",
        copy: "Check the start and end times and the longest booking below.",
      };
    case "not_requestable":
      return {
        tone: "neutral" as const,
        title: "Not taking requests right now",
        copy: "You can still read about the room. Requests are paused by its manager.",
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
  }));
  const weekOrder = [1, 2, 3, 4, 5, 6, 0].map((weekday) => hoursByDay[weekday]!);

  const canManage =
    profile.role === "admin" ||
    (profile.role === "manager" &&
      getDatabase()
        .prepare("SELECT 1 FROM rooms WHERE id = ? AND manager_id = ?")
        .get(room.id, profile.id) !== undefined);
  const requestHref = `/app/rooms/${encodeURIComponent(room.code)}/request${
    requestQuery ? `?${requestQuery}` : ""
  }`;
  const rule = ALLOCATION_RULE_COPY[room.policy.allocationRule];
  const banner = parsed.ok && interval && room.availability ? availabilityBanner(room.availability) : null;
  const bannerStyles = {
    green: "border-flag-green/25 bg-flag-green-bg",
    red: "border-flag-red/25 bg-flag-red-bg",
    amber: "border-flag-amber/25 bg-flag-amber-bg",
    neutral: "border-sand-200 bg-white",
  } as const;
  const offerWaitlist =
    canRequest && room.availability === "conflict" && room.policy.waitlistEnabled;

  return (
    <div className="space-y-6">
      <nav className="text-sm text-ink-600" aria-label="Breadcrumb">
        <Link href={`/app/rooms${requestQuery ? `?${requestQuery}` : ""}`} className="hover:text-ink-950">
          Find a room
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="font-semibold text-ink-800">{room.name}</span>
      </nav>

      <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div>
          <h1 className="font-display text-4xl leading-[1.05] tracking-[-0.03em] text-ink-950 sm:text-5xl">
            {room.name}
          </h1>
          <p className="mt-3 text-base leading-7 text-ink-700">
            {room.building}, {room.location} · {room.capacity} seats · {room.code}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          {canRequest ? (
            <Link href={requestHref} className="btn-primary">
              {offerWaitlist ? "Join the waitlist" : "Request this room"}
            </Link>
          ) : !room.policy.requestsEnabled ? (
            <span className="rounded-full border border-sand-200 bg-white px-4 py-2 text-sm font-semibold text-ink-600">
              Not taking requests
            </span>
          ) : null}
          {canManage ? (
            <Link href={`/app/admin/rooms/${room.id}`} className="btn-secondary">
              Room settings
            </Link>
          ) : null}
        </div>
      </section>

      {banner && interval ? (
        <section className={`flex flex-col justify-between gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:p-5 ${bannerStyles[banner.tone]}`}>
          <div>
            <p className="text-base font-bold text-ink-950">
              {banner.title}: {interval.dateLabel}, {interval.startLabel}–{interval.endLabel}
            </p>
            <p className="mt-1 text-sm leading-6 text-ink-700">{banner.copy}</p>
          </div>
          <Link
            href={`/app/rooms?${toRoomSearchQuery({
              date: interval.date,
              startTime: interval.startLabel,
              endTime: interval.endLabel,
            }).toString()}`}
            className="btn-secondary shrink-0"
          >
            Other rooms at this time
          </Link>
        </section>
      ) : !parsed.ok ? (
        <div role="alert" className="rounded-xl border border-flag-amber/20 bg-flag-amber-bg px-4 py-3 text-sm text-flag-amber">
          {parsed.error}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="space-y-5">
          <section className="surface p-5 sm:p-6">
            <h2 className="text-lg font-bold tracking-tight text-ink-950">About this room</h2>
            {room.policySummary ? (
              <p className="mt-2 text-sm leading-6 text-ink-700">{room.policySummary}</p>
            ) : null}
            {room.facilities.length > 0 ? (
              <ul className="mt-4 flex flex-wrap gap-2" aria-label="Facilities">
                {room.facilities.map((facility) => (
                  <li key={facility} className="rounded-lg border border-sand-200 bg-sand-50 px-3 py-1.5 text-sm text-ink-800">
                    {facility}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="surface p-5 sm:p-6">
            <h2 className="text-lg font-bold tracking-tight text-ink-950">Booking rules</h2>
            <dl className="mt-4 divide-y divide-sand-200">
              {describePolicy(room.policy).map((line) => (
                <div key={line.label} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:justify-between sm:gap-6">
                  <dt className="text-sm text-ink-600">{line.label}</dt>
                  <dd className="text-sm font-semibold text-ink-950 sm:text-right">{line.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="surface p-5 sm:p-6" aria-labelledby="rule-heading">
            <h2 id="rule-heading" className="text-lg font-bold tracking-tight text-ink-950">
              If others want the same time
            </h2>
            <p className="mt-1 text-sm leading-6 text-ink-700">
              This room uses <strong className="font-semibold text-ink-950">{rule.label}</strong>. Competing requests are put in this order:
            </p>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-ink-800">
              {rule.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="mt-3 text-sm leading-6 text-ink-600">
              The manager can approve out of this order only by recording a
              reason, which is kept with the decision.
              {room.policy.waitlistEnabled
                ? " Everyone else moves to the waitlist and is told their place."
                : ""}
            </p>
          </section>

          <section className="surface p-5 sm:p-6">
            <h2 className="text-lg font-bold tracking-tight text-ink-950">Requirements</h2>
            {room.requirements.length > 0 ? (
              <ul className="mt-4 divide-y divide-sand-200">
                {room.requirements.map((requirement) => (
                  <li key={requirement.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-ink-900">{requirement.description}</p>
                      <p className="mt-0.5 text-xs text-ink-600">{requirement.required ? "Required" : "Recommended"}</p>
                    </div>
                    {profile.role === "student" ? (
                      requirement.verification === "verified" ? (
                        <StatusChip tone="green">You&apos;ve done this</StatusChip>
                      ) : requirement.verification === "expired" ? (
                        <StatusChip tone="red">Expired</StatusChip>
                      ) : (
                        <StatusChip tone="amber">Not done yet</StatusChip>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-700">None. Anyone with a student account can request it.</p>
            )}
            {unverifiedRequired.length > 0 && canRequest ? (
              <p className="mt-4 rounded-xl border border-flag-amber/20 bg-flag-amber-bg p-4 text-sm leading-6 text-flag-amber">
                You can still send a request. The manager checks requirements
                before approving, and requests that already meet them are
                ranked first.
              </p>
            ) : null}
          </section>
        </div>

        <div className="space-y-5">
          <section className="surface p-5">
            <h2 className="text-lg font-bold tracking-tight text-ink-950">Opening hours</h2>
            {room.hours.length > 0 ? (
              <dl className="mt-3 space-y-2">
                {weekOrder.map((day) => (
                  <div key={day.label} className="flex items-center justify-between gap-4 text-sm">
                    <dt className="text-ink-600">{day.label}</dt>
                    <dd className={day.hours.length > 0 ? "font-semibold tabular-nums text-ink-950" : "text-ink-600"}>
                      {day.hours.length > 0 ? hoursLabel(day.hours) : "Closed"}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-2 text-sm text-ink-600">No opening hours are set, so it can&apos;t be requested yet.</p>
            )}
          </section>

          <section className="surface p-5">
            <h2 className="text-lg font-bold tracking-tight text-ink-950">Planned closures</h2>
            {room.upcomingBlackouts.length > 0 ? (
              <ul className="mt-3 space-y-3">
                {room.upcomingBlackouts.map((blackout) => (
                  <li key={blackout.id} className="text-sm">
                    <p className="font-semibold text-ink-950">{blackoutLabel(blackout.startsAt, blackout.endsAt)}</p>
                    <p className="text-ink-600">{blackout.reason}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-600">None planned.</p>
            )}
          </section>

          <section className="rounded-2xl bg-ink-950 p-5 text-white">
            <h2 className="font-display text-2xl tracking-[-0.02em]">How booking works</h2>
            <ol className="mt-4 space-y-3 text-sm leading-6 text-white/75">
              <li><strong className="text-white">Ask.</strong> Send a request with your time, group size, and purpose.</li>
              <li><strong className="text-white">Wait for approval.</strong> The manager approves or declines; you&apos;re notified either way. A request isn&apos;t a booking.</li>
              <li><strong className="text-white">Check in and out.</strong> Tap your card when you arrive, and check out with a note on the room when you leave.</li>
            </ol>
            {canRequest ? (
              <Link href={requestHref} className="btn-primary mt-5 w-full">
                {offerWaitlist ? "Join the waitlist" : "Request this room"}
              </Link>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
