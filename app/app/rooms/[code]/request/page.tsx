import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { BookingRequestForm } from "@/app/app/rooms/[code]/request/booking-form";
import { requireCurrentProfile } from "@/lib/auth/session";
import { getCampusTimezone } from "@/lib/config";
import { getDatabase } from "@/lib/db/client";
import { canRequestRoom, getRoomDetail } from "@/lib/rooms/queries";
import { parseRoomSearchParams } from "@/lib/rooms/search";
import { nextWeekdayLocalDate } from "@/lib/time/campus-time";
import { ALLOCATION_RULE_COPY, describePolicy } from "@/lib/rooms/policy";

export const metadata: Metadata = {
  title: "Request a room",
  description: "Send a room request to the room's manager.",
};

export default async function RoomRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireCurrentProfile();

  if (profile.role !== "student") {
    notFound();
  }

  const { code } = await params;
  const rawParams = await searchParams;
  const parsed = parseRoomSearchParams(rawParams);
  const room = await getRoomDetail(getDatabase(), profile, code, null);

  if (!room || !canRequestRoom(profile, room)) {
    notFound();
  }

  const timeZone = getCampusTimezone();
  const defaults = {
    startDate: parsed.ok
      ? parsed.values.date || nextWeekdayLocalDate()
      : nextWeekdayLocalDate(),
    startTime: parsed.ok ? parsed.values.startTime || "10:00" : "10:00",
    endTime: parsed.ok ? parsed.values.endTime || "11:00" : "11:00",
    expectedAttendance: (() => {
      const raw = Array.isArray(rawParams.people) ? rawParams.people[0] : rawParams.people;
      const value = Number(raw);
      return Number.isInteger(value) && value >= 1 && value <= room.capacity
        ? String(value)
        : String(Math.min(2, room.capacity));
    })(),
  };
  const unverifiedRequirements = room.requirements.filter(
    (requirement) =>
      requirement.required && requirement.verification !== "verified",
  );

  const rule = ALLOCATION_RULE_COPY[room.policy.allocationRule];

  return (
    <div className="space-y-6">
      <nav className="text-sm text-ink-600" aria-label="Breadcrumb">
        <Link href="/app/rooms" className="hover:text-ink-950">
          Find a room
        </Link>
        <span aria-hidden="true"> / </span>
        <Link href={`/app/rooms/${encodeURIComponent(room.code)}`} className="hover:text-ink-950">
          {room.name}
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="font-semibold text-ink-800">Request</span>
      </nav>

      <section>
        <h1 className="font-display text-4xl leading-[1.05] tracking-[-0.03em] text-ink-950 sm:text-5xl">
          Request {room.name}
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-ink-700">
          Tell the room manager when and why. You&apos;ll be notified as soon as
          they decide.
        </p>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.85fr]">
        <section className="surface p-5 sm:p-6">
          <BookingRequestForm
            roomCode={room.code}
            capacity={room.capacity}
            slotMinutes={room.policy.slotIntervalMinutes}
            ruleLabel={rule.label}
            idempotencyKey={randomUUID()}
            timeZone={timeZone}
            defaults={defaults}
            requirements={room.requirements}
          />
        </section>

        <aside className="space-y-5">
          <section className="surface p-5">
            <h2 className="text-lg font-bold text-ink-950">{room.name}</h2>
            <p className="mt-1 text-sm text-ink-600">
              {room.building}, {room.location} · {room.capacity} seats
            </p>
            {room.policySummary ? (
              <p className="mt-3 text-sm leading-6 text-ink-700">{room.policySummary}</p>
            ) : null}
            <dl className="mt-4 space-y-2 border-t border-sand-200 pt-4 text-sm">
              {describePolicy(room.policy).map((line) => (
                <div key={line.label} className="flex items-start justify-between gap-3">
                  <dt className="text-ink-600">{line.label}</dt>
                  <dd className="text-right font-semibold text-ink-950">{line.value}</dd>
                </div>
              ))}
              <div className="flex items-start justify-between gap-3">
                <dt className="text-ink-600">Requirements</dt>
                <dd className="text-right font-semibold text-ink-950">
                  {unverifiedRequirements.length > 0
                    ? `${unverifiedRequirements.length} not done yet`
                    : requiredRequirementLabel(room.requirements)}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl bg-ink-950 p-5 text-white">
            <h2 className="font-display text-xl tracking-[-0.02em]">If someone else wants the same time</h2>
            <p className="mt-2 text-sm leading-6 text-white/70">
              This room uses {rule.label}: {rule.short.toLowerCase()} If the time
              is already booked, you can join the waitlist instead.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function requiredRequirementLabel(
  requirements: Array<{ required: boolean; verification: string | null }>,
): string {
  const required = requirements.filter((requirement) => requirement.required);
  return required.length === 0 ? "None" : "All done";
}
