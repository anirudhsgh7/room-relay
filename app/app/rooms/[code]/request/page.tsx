import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { BrandMark } from "@/components/brand";
import { StatusChip } from "@/components/badges";
import { BookingRequestForm } from "@/app/app/rooms/[code]/request/booking-form";
import { requireCurrentProfile } from "@/lib/auth/session";
import { getCampusTimezone } from "@/lib/config";
import { getDatabase } from "@/lib/db/client";
import { canRequestRoom, getRoomDetail } from "@/lib/rooms/queries";
import { parseRoomSearchParams } from "@/lib/rooms/search";
import { nextWeekdayLocalDate } from "@/lib/time/campus-time";

export const metadata: Metadata = {
  title: "Request a room",
  description: "Submit a room request for manager review.",
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
  const room = getRoomDetail(getDatabase(), profile, code, null);

  if (!room || !canRequestRoom(profile, room)) {
    notFound();
  }

  const timeZone = getCampusTimezone();
  const defaults = {
    startDate: parsed.ok
      ? parsed.values.date || nextWeekdayLocalDate()
      : nextWeekdayLocalDate(),
    startTime: parsed.ok ? parsed.values.startTime || "10:00" : "10:00",
    endTime: parsed.ok ? parsed.values.endTime || "11:30" : "11:30",
  };
  const unverifiedRequirements = room.requirements.filter(
    (requirement) =>
      requirement.required && requirement.verification !== "verified",
  );

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-xs text-ink-600" aria-label="Breadcrumb">
        <Link href="/app/rooms" className="hover:text-ink-950">
          Room discovery
        </Link>
        <span aria-hidden="true">/</span>
        <Link
          href={`/app/rooms/${encodeURIComponent(room.code)}`}
          className="hover:text-ink-950"
        >
          {room.code}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-semibold text-ink-800">Request</span>
      </nav>

      <section>
        <div className="flex flex-wrap items-center gap-2.5">
          <p className="eyebrow">New request · Pending by design</p>
          <StatusChip tone="amber">Not approved yet</StatusChip>
        </div>
        <h1 className="mt-3 max-w-3xl font-display text-4xl leading-[1.02] tracking-[-0.04em] text-ink-950 sm:text-5xl">
          Request {room.name}.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-ink-700">
          Tell the room manager what you need. Submitting creates a pending
          request; it does not reserve the room or authorize entry.
        </p>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.85fr]">
        <section className="surface p-5 sm:p-6">
          <BookingRequestForm
            roomCode={room.code}
            roomName={room.name}
            capacity={room.capacity}
            idempotencyKey={randomUUID()}
            timeZone={timeZone}
            defaults={defaults}
            requirements={room.requirements}
          />
        </section>

        <aside className="space-y-5">
          <section className="relative overflow-hidden rounded-2xl bg-ink-950 p-5 text-white">
            <div className="grid-paper pointer-events-none absolute inset-0 opacity-70" />
            <div className="relative">
              <BrandMark tone="dark" size="sm" />
              <p className="mt-4 label text-brand-300">Your request</p>
              <h2 className="mt-2 font-display text-2xl tracking-[-0.03em]">
                {room.name}
              </h2>
              <p className="mt-1 text-xs text-white/45">
                {room.building} · {room.location}
              </p>
              <div className="mt-5 space-y-3 border-t border-white/10 pt-4 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white/45">Capacity</span>
                  <span className="font-semibold">{room.capacity} seats</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white/45">Booking window</span>
                  <span className="text-right font-semibold">
                    {room.policy.slotIntervalMinutes} min slots
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white/45">Maximum</span>
                  <span className="font-semibold">
                    {room.policy.maximumDurationMinutes} minutes
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white/45">Notice required</span>
                  <span className="font-semibold">
                    {room.policy.minimumNoticeMinutes} minutes
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white/45">Timezone</span>
                  <span className="max-w-[9rem] break-all text-right font-mono text-[0.62rem]">
                    {timeZone}
                  </span>
                </div>
              </div>
              <div className="mt-5 rounded-xl border border-brand-300/20 bg-brand-300/[0.08] p-3.5">
                <p className="text-[0.62rem] font-bold uppercase tracking-[0.13em] text-brand-300">
                  Remember
                </p>
                <p className="mt-1.5 text-xs leading-5 text-white/60">
                  Pending is not approved. A manager reviews the request before
                  it becomes permission to use the room.
                </p>
              </div>
            </div>
          </section>

          <section className="surface p-5">
            <p className="eyebrow">Room rules</p>
            <p className="mt-2 text-sm leading-6 text-ink-700">
              {room.policySummary}
            </p>
            <div className="mt-4 space-y-2.5 border-t border-sand-200 pt-4 text-xs">
              <div className="flex items-start justify-between gap-3">
                <span className="text-ink-600">Requested by</span>
                <span className="text-right font-semibold text-ink-950">
                  {profile.displayName}
                </span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-ink-600">Requirements</span>
                <span className="text-right font-semibold text-ink-950">
                  {unverifiedRequirements.length > 0
                    ? `${unverifiedRequirements.length} needs review`
                    : requiredRequirementLabel(room.requirements)}
                </span>
              </div>
            </div>
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
  return required.length === 0 ? "None" : `${required.length} verified`;
}
