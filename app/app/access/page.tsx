import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { AccessAttemptForm } from "@/components/access/access-attempt-form";
import { BookingStatusChip, StatusChip } from "@/components/badges";
import { getAccessSimulatorData, listAccessHistory } from "@/lib/access/queries";
import { requireCurrentProfile } from "@/lib/auth/session";
import { getCampusTimezone } from "@/lib/config";
import { getDatabase } from "@/lib/db/client";
import type { BookingStatus } from "@/lib/domain";

export const metadata: Metadata = {
  title: "Access checks",
  description: "Run a simulated, time-bound room access check.",
};

export default async function AccessPage() {
  const profile = await requireCurrentProfile();
  const db = getDatabase();
  const data = getAccessSimulatorData(db, profile);
  const timezone = getCampusTimezone();
  const now = new Date();
  const recent = listAccessHistory(db, profile, {
    roomCode: "",
    result: "all",
    reasonCode: "",
    date: "",
    page: 1,
  });
  const nowLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(now);
  const activeWindow = data.accessWindows.find(
    (window) =>
      Date.parse(window.startAt) <= now.getTime() &&
      now.getTime() < Date.parse(window.endAt),
  );

  return (
    <div className="space-y-7">
      <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusChip tone="neutral">Simulated: no real door is opened</StatusChip>
          </div>
          <h1 className="mt-3 max-w-3xl font-display text-4xl leading-[1.03] tracking-[-0.04em] text-ink-950 sm:text-5xl">
            {profile.role === "student" ? "Check in" : "Tap simulator"}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-ink-700 sm:text-base sm:leading-7">
            {profile.role === "student"
              ? "When you arrive for an approved booking, choose your card and the room, then tap. It works only inside your booked time."
              : "Try a card tap as the reader would. Staff accounts have no bookings, so taps are refused; the attempt is still logged."}
          </p>
          <p className="mt-3 inline-flex rounded-full border border-ink-950/10 bg-white px-3 py-1.5 text-xs text-ink-700">
            Campus time now: {nowLabel}
          </p>
        </div>
        <Link href="/app/access/history" className="btn-secondary shrink-0">
          {profile.role === "student" ? "My taps" : "Access log"}
        </Link>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.85fr]">
        <section className="surface p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-ink-950">
                Tap your card
              </h2>
              <p className="mt-1 text-sm leading-6 text-ink-600">
                The first successful tap checks you in. Every tap is recorded.
              </p>
            </div>
            <StatusChip tone="neutral">Software only</StatusChip>
          </div>

          <AccessAttemptForm
            credentials={data.credentials}
            rooms={data.rooms}
            accessWindows={data.accessWindows}
            initialNonce={randomUUID()}
            timeZone={timezone}
            suggestedCredentialId={data.suggestedCredentialId}
            suggestedRoomId={data.suggestedRoomId}
          />
        </section>

        <div className="space-y-5">
          <section className="relative overflow-hidden rounded-2xl bg-ink-950 p-5 text-white">
            <div className="grid-paper pointer-events-none absolute inset-0 opacity-70" />
            <div className="relative">
              <h2 className="font-display text-2xl leading-tight tracking-[-0.03em]">
                When a tap works
              </h2>
              <ul className="mt-4 space-y-3">
                {[
                  "It's your own card, and it hasn't been cancelled",
                  "You have an approved booking for this room",
                  "It's between your booking's start and end time",
                  "Every tap is recorded, allowed or not",
                ].map((item) => (
                  <li
                    key={item}
                    className="flex gap-2.5 text-xs leading-5 text-white/55"
                  >
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-brand-300" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3">
                <p className="text-xs leading-5 text-white/60">
                  No card reader or door lock is connected in this version. The
                  check is simulated in software.
                </p>
              </div>
            </div>
          </section>

          <section className="surface p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Your access windows</p>
                <h2 className="mt-2 text-lg font-bold tracking-tight text-ink-950">
                  Approved or checked in
                </h2>
              </div>
              {activeWindow ? (
                <StatusChip tone="green">Active now</StatusChip>
              ) : null}
            </div>
            {data.accessWindows.length > 0 ? (
              <ul className="mt-4 space-y-2.5">
                {data.accessWindows.map((window) => {
                  const isActive =
                    Date.parse(window.startAt) <= now.getTime() &&
                    now.getTime() < Date.parse(window.endAt);
                  const isDemo = window.id === "booking_demo_active_classroom";

                  return (
                    <li
                      key={window.id}
                      className={`rounded-xl border p-3 ${
                        isActive
                          ? "border-flag-green/20 bg-flag-green-bg"
                          : "border-sand-200 bg-sand-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-ink-950">
                            {window.roomName}
                          </p>
                          <p className="mt-0.5 text-[0.65rem] text-ink-600">
                            {window.dateLabel} · {window.timeLabel}
                          </p>
                        </div>
                        <BookingStatusChip
                          status={window.status as BookingStatus}
                        />
                      </div>
                      {isActive || isDemo ? (
                        <p className="mt-2 text-[0.62rem] leading-4 text-ink-600">
                          {isDemo
                            ? "Synthetic demo access window seeded around the current time."
                            : "Inside the current access window."}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-4 rounded-xl border border-sand-200 bg-sand-50 p-3 text-xs leading-5 text-ink-600">
                You do not have an approved or checked-in booking yet.
              </p>
            )}
          </section>

          <section className="surface p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Recent activity</p>
                <h2 className="mt-2 text-lg font-bold tracking-tight text-ink-950">
                  Scoped to your role
                </h2>
              </div>
              <Link
                href="/app/access/history"
                className="text-xs font-semibold text-brand-700 hover:text-brand-600"
              >
                View all
              </Link>
            </div>
            {recent.items.length > 0 ? (
              <ul className="mt-4 divide-y divide-sand-200">
                {recent.items.slice(0, 4).map((event) => (
                  <li
                    key={event.id}
                    className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div>
                      <p className="text-xs font-semibold text-ink-950">
                        {event.roomName}
                      </p>
                      <p className="mt-0.5 text-[0.65rem] text-ink-600">
                        {event.dateLabel} · {event.timeLabel}
                      </p>
                    </div>
                    <StatusChip
                      tone={event.result === "allowed" ? "green" : "red"}
                    >
                      {event.result === "allowed" ? "Allowed" : "Denied"}
                    </StatusChip>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-xs text-ink-600">No attempts yet.</p>
            )}
          </section>
        </div>
      </div>

      <p className="text-center text-[0.65rem] leading-5 text-ink-600/80">
        Software simulation only. No physical door, lock, or emergency-egress
        system is connected.
      </p>
    </div>
  );
}
