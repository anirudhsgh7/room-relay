import Link from "next/link";
import { BookingStatusChip } from "@/components/badges";
import { requireCurrentProfile } from "@/lib/auth/session";
import { getCampusTimezone } from "@/lib/config";
import { getDatabase } from "@/lib/db/client";
import { listNotifications } from "@/lib/notifications/service";
import { formatRelative } from "@/lib/time/relative";
import {
  getStaffHome,
  getStudentHome,
  type HomeAction,
  type HomeTone,
} from "@/lib/workspace/home";

const ACTION_STYLES: Record<HomeTone, string> = {
  good: "border-flag-green/25 bg-flag-green-bg",
  attention: "border-flag-amber/25 bg-flag-amber-bg",
  problem: "border-flag-red/25 bg-flag-red-bg",
  neutral: "border-sand-200 bg-white",
};

const STAT_STYLES: Record<HomeTone, string> = {
  good: "text-flag-green",
  attention: "text-flag-amber",
  problem: "text-flag-red",
  neutral: "text-ink-950",
};

function greeting(hour: number): string {
  if (hour < 12) {
    return "Good morning";
  }
  if (hour < 18) {
    return "Good afternoon";
  }
  return "Good evening";
}

function ActionList({ actions }: { actions: HomeAction[] }) {
  return (
    <ul className="space-y-3">
      {actions.map((action) => (
        <li
          key={`${action.href}-${action.title}`}
          className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${ACTION_STYLES[action.tone]}`}
        >
          <div>
            <p className="text-base font-bold text-ink-950">{action.title}</p>
            <p className="mt-1 text-sm leading-6 text-ink-700">{action.detail}</p>
          </div>
          <Link href={action.href} className="btn-dark shrink-0">
            {action.cta}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function SectionHeading({
  title,
  link,
}: {
  title: string;
  link?: { href: string; label: string };
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-lg font-bold tracking-tight text-ink-950">{title}</h2>
      {link ? (
        <Link href={link.href} className="text-sm font-semibold text-brand-700 hover:text-brand-600">
          {link.label}
        </Link>
      ) : null}
    </div>
  );
}

export default async function HomePage() {
  const profile = await requireCurrentProfile();
  const db = getDatabase();
  const timezone = getCampusTimezone();
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(now),
  );
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  const firstName = profile.displayName.split(/\s+/)[0];
  const recent = await listNotifications(db, profile, { limit: 4 });

  const header = (
    <header>
      <p className="text-sm font-semibold text-ink-600">{dateLabel}</p>
      <h1 className="mt-1 font-display text-4xl leading-tight tracking-[-0.03em] text-ink-950 sm:text-5xl">
        {greeting(hour)}, {firstName}.
      </h1>
    </header>
  );

  const notificationsSection =
    recent.length > 0 ? (
      <section>
        <SectionHeading title="Latest updates" link={{ href: "/app/notifications", label: "All notifications" }} />
        <ul className="surface divide-y divide-sand-200">
          {recent.map((item) => (
            <li key={item.id} className="px-4 py-3">
              <p className={`text-sm text-ink-950 ${item.readAt ? "" : "font-semibold"}`}>{item.title}</p>
              <p className="mt-0.5 text-xs text-ink-600">{formatRelative(item.createdAt)}</p>
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  if (profile.role === "student") {
    const home = await getStudentHome(db, profile);

    return (
      <div className="space-y-8">
        {header}

        {home.actions.length > 0 ? (
          <section aria-labelledby="now-heading">
            <h2 id="now-heading" className="sr-only">
              Needs you now
            </h2>
            <ActionList actions={home.actions} />
          </section>
        ) : null}

        <section className="rounded-2xl bg-ink-950 p-6 text-white sm:p-8">
          <h2 className="font-display text-2xl tracking-[-0.02em] sm:text-3xl">Need a room?</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-white/70">
            Pick a day, time, and group size to see what&apos;s free. Your request
            goes to the room&apos;s manager, and you&apos;ll be notified of the decision.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/app/rooms" className="btn-primary">
              Find a room
            </Link>
            <p className="self-center text-sm text-white/60">
              or ask the assistant, e.g. “a room for 8 tomorrow at 2pm”
            </p>
          </div>
        </section>

        <div className={recent.length > 0 ? "grid gap-8 lg:grid-cols-[1.4fr_1fr]" : ""}>
          <section>
            <SectionHeading
              title="Your upcoming bookings"
              link={home.upcomingTotal > 0 ? { href: "/app/bookings", label: "See all" } : undefined}
            />
            {home.upcoming.length === 0 ? (
              <div className="surface p-5 text-sm leading-6 text-ink-700">
                Nothing booked yet. When you send a request, it shows up here with
                its status.
              </div>
            ) : (
              <ul className="surface divide-y divide-sand-200">
                {home.upcoming.map((booking) => (
                  <li key={booking.id}>
                    <Link href={booking.href} className="flex items-start justify-between gap-3 px-4 py-3.5 hover:bg-sand-50">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink-950">{booking.roomName}</p>
                        <p className="mt-0.5 text-sm text-ink-700">{booking.when}</p>
                        {booking.note ? <p className="mt-0.5 text-xs text-ink-600">{booking.note}</p> : null}
                      </div>
                      <BookingStatusChip status={booking.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {notificationsSection}
        </div>
      </div>
    );
  }

  const home = await getStaffHome(db, profile);
  const decideCount = home.stats[0]?.value ?? 0;

  return (
    <div className="space-y-8">
      {header}

      {home.actions.length > 0 ? <ActionList actions={home.actions} /> : null}

      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {home.stats.map((stat) => (
          <Link key={stat.label} href={stat.href} className="surface p-4 transition hover:border-ink-950/20">
            <p className={`font-display text-4xl leading-none tracking-[-0.03em] ${STAT_STYLES[stat.tone]}`}>
              {stat.value}
            </p>
            <p className="mt-2 text-sm font-medium text-ink-700">{stat.label}</p>
          </Link>
        ))}
      </section>

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <section>
          <SectionHeading
            title="Decide next"
            link={decideCount > 0 ? { href: "/app/manager/queue", label: "Open review queue" } : undefined}
          />
          {home.decideSoon.length === 0 ? (
            <div className="surface p-5 text-sm text-ink-700">No requests are waiting for a decision.</div>
          ) : (
            <ul className="surface divide-y divide-sand-200">
              {home.decideSoon.map((item) => (
                <li key={item.id}>
                  <Link href={item.href} className="flex items-start justify-between gap-3 px-4 py-3.5 hover:bg-sand-50">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-950">
                        {item.requesterName} <span className="font-normal text-ink-600">for</span> {item.roomName}
                      </p>
                      <p className="mt-0.5 text-sm text-ink-700">{item.when}</p>
                    </div>
                    {item.competing > 0 ? (
                      <span className="chip shrink-0 border-flag-amber/20 bg-flag-amber-bg text-flag-amber">
                        {item.competing + 1} want this time
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-8">
            <SectionHeading title={profile.role === "admin" ? "Today across campus" : "Today in your rooms"} />
            {home.today.length === 0 ? (
              <div className="surface p-5 text-sm text-ink-700">No bookings today.</div>
            ) : (
              <ul className="surface divide-y divide-sand-200">
                {home.today.map((item) => (
                  <li key={item.id}>
                    <Link href={item.href} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-sand-50">
                      <div className="flex min-w-0 items-baseline gap-3">
                        <span className="w-24 shrink-0 text-sm font-semibold tabular-nums text-ink-950">{item.when}</span>
                        <span className="truncate text-sm text-ink-700">
                          {item.roomName} · {item.requesterName}
                        </span>
                      </div>
                      <BookingStatusChip status={item.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <div className="space-y-8">
          {home.roomsNeedingSetup.length > 0 ? (
            <section>
              <SectionHeading title="Rooms to set up" />
              <ul className="surface divide-y divide-sand-200">
                {home.roomsNeedingSetup.map((room) => (
                  <li key={room.id}>
                    <Link href={`/app/admin/rooms/${room.id}`} className="block px-4 py-3 hover:bg-sand-50">
                      <p className="font-semibold text-ink-950">{room.name}</p>
                      <p className="mt-0.5 text-sm text-ink-700">{room.problem}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {notificationsSection}
        </div>
      </div>
    </div>
  );
}
