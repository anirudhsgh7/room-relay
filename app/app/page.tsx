import Link from "next/link";
import { RoleBadge, StatusChip } from "@/components/badges";
import { requireCurrentProfile } from "@/lib/auth/session";
import { getCampusTimezone } from "@/lib/config";
import { getDatabase } from "@/lib/db/client";
import {
  getFoundationSnapshot,
  getRoleWorkspaceCopy,
  type FoundationSnapshot,
} from "@/lib/db/queries";
import type { Role } from "@/lib/domain";

interface Metric {
  label: string;
  value: string;
  detail: string;
}

function metricsFor(
  role: Role,
  snapshot: FoundationSnapshot,
): Metric[] {
  if (role === "student") {
    return [
      {
        label: "Active room options",
        value: String(snapshot.activeRooms),
        detail: "staged in the demo catalog",
      },
      {
        label: "Active credentials",
        value: String(snapshot.ownActiveCredentials ?? 0),
        detail: "mapped to your account",
      },
      {
        label: "Requests underway",
        value: String(snapshot.ownActiveBookings ?? 0),
        detail: "pending or approved demo records",
      },
      {
        label: "Role boundary",
        value: "Server",
        detail: "resolved from your profile",
      },
    ];
  }

  if (role === "manager") {
    return [
      {
        label: "Assigned rooms",
        value: String(snapshot.assignedRooms.length),
        detail: "in your active portfolio",
      },
      {
        label: "Pending requests",
        value: String(snapshot.managedPendingBookings ?? 0),
        detail: "for your rooms only",
      },
      {
        label: "Active catalog",
        value: String(snapshot.activeRooms),
        detail: "institution rooms available",
      },
      {
        label: "Manager scope",
        value: "Room",
        detail: "not institution-wide",
      },
    ];
  }

  return [
    {
      label: "Active profiles",
      value: String(snapshot.institutionActiveProfiles ?? 0),
      detail: `of ${snapshot.institutionProfiles ?? 0} seeded accounts`,
    },
    {
      label: "Active rooms",
      value: String(snapshot.activeRooms),
      detail: `of ${snapshot.totalRooms} seeded rooms`,
    },
    {
      label: "Credentials",
      value: String(snapshot.institutionCredentials ?? 0),
      detail: "active and revoked records",
    },
    {
      label: "Pending requests",
      value: String(snapshot.institutionPendingBookings ?? 0),
      detail: "lifecycle records staged",
    },
  ];
}

const readiness = [
  {
    title: "Server-verified identity",
    copy: "Sessions are signed, HTTP-only, and checked against the database on each request.",
  },
  {
    title: "Role and account status",
    copy: "Student, manager, and admin scope comes from the persisted profile—not a client value.",
  },
  {
    title: "Lifecycle schema",
    copy: "Rooms, availability, requests, decisions, credentials, access, and audit records are versioned.",
  },
  {
    title: "Repeatable demo dataset",
    copy: "Seed runs are idempotent, with two manager portfolios for scope testing.",
  },
  {
    title: "Room discovery and requests",
    copy: "Active catalog search, availability checks, eligibility warnings, and persistent pending requests are live.",
  },
  {
    title: "Manager decisions and requester cancellation",
    copy: "Room-scoped review, reasoned approve/reject decisions, eligibility overrides, and future-booking cancellation are live.",
  },
  {
    title: "Time-bound access checks",
    copy: "Own-credential simulation, exact booking-window policy, allow/deny reason codes, and append-only access history are live.",
  },
  {
    title: "Check-out, conditions, and incidents",
    copy: "Post-use condition reports, clean completion, human-reviewed incidents, and a connected lifecycle timeline are live.",
  },
  {
    title: "Hardening and submission",
    copy: "Deployment verification, full reliability testing, a backup demo, and final submission materials remain for Phase 6.",
    upcoming: true,
  },
];

const roadmap = [
  {
    phase: "06",
    title: "Hardening and submission",
    detail: "Deployment verification, backup demo, and final submission materials.",
  },
];

export default async function WorkspacePage() {
  const profile = await requireCurrentProfile();
  const db = getDatabase();
  const snapshot = getFoundationSnapshot(db, profile);
  const copy = getRoleWorkspaceCopy(profile.role);
  const metrics = metricsFor(profile.role, snapshot);
  const timezone = getCampusTimezone();
  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  const timeLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);

  return (
    <div className="space-y-7">
      <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <p className="eyebrow">{copy.eyebrow}</p>
            <StatusChip tone="green">Phase 5 live</StatusChip>
          </div>
          <h1 className="mt-3 max-w-3xl font-display text-4xl leading-[1.03] tracking-[-0.04em] text-ink-950 sm:text-5xl">
            {copy.title}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-ink-700 sm:text-base sm:leading-7">
            {copy.description}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/app/rooms" className="btn-primary min-h-10 px-4 py-2 text-xs">
              Browse rooms
            </Link>
            {profile.role === "student" ? (
              <Link
                href="/app/bookings"
                className="btn-secondary min-h-10 px-4 py-2 text-xs"
              >
                My requests
              </Link>
            ) : (
              <Link
                href="/app/manager/queue"
                className="btn-secondary min-h-10 px-4 py-2 text-xs"
              >
                Manager queue
              </Link>
            )}
            <Link
              href="/app/access"
              className="btn-dark min-h-10 px-4 py-2 text-xs"
            >
              Simulate access
            </Link>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-sand-200 bg-white px-4 py-3">
          <span className="inline-flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <svg
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
              className="size-4"
            >
              <circle
                cx="10"
                cy="10"
                r="7"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M10 6v4l2.5 1.75"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <div>
            <p className="text-xs font-bold text-ink-950">{dateLabel}</p>
            <p className="mt-0.5 text-[0.68rem] text-ink-600">
              {timeLabel} · {timezone}
            </p>
          </div>
        </div>
      </section>

      <section aria-label="Foundation metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <article key={metric.label} className="surface p-4 sm:p-5">
            <p className="text-[0.66rem] font-bold uppercase tracking-[0.14em] text-ink-600">
              {metric.label}
            </p>
            <p className="mt-3 font-display text-4xl leading-none tracking-[-0.04em] text-ink-950">
              {metric.value}
            </p>
            <p className="mt-2 text-xs leading-5 text-ink-600">{metric.detail}</p>
          </article>
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.85fr]">
        <div className="space-y-5">
          <section className="surface overflow-hidden">
            <div className="flex items-center justify-between gap-4 border-b border-sand-200 px-5 py-4">
              <div>
                <p className="text-sm font-bold text-ink-950">
                  Workspace readiness
                </p>
                <p className="mt-0.5 text-xs text-ink-600">
                  What is real in this build, and what is deliberately next.
                </p>
              </div>
              <span className="font-mono text-[0.62rem] font-semibold text-ink-600">
                BUILD 05
              </span>
            </div>
            <ul className="divide-y divide-sand-200">
              {readiness.map((item) => (
                <li key={item.title} className="flex gap-3.5 px-5 py-4">
                  <span
                    className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full ${
                      item.upcoming
                        ? "border border-dashed border-ink-950/20 text-ink-600"
                        : "bg-flag-green-bg text-flag-green"
                    }`}
                  >
                    {item.upcoming ? (
                      <span className="size-1.5 rounded-full border border-current" />
                    ) : (
                      <svg
                        viewBox="0 0 12 12"
                        fill="none"
                        aria-hidden="true"
                        className="size-3"
                      >
                        <path
                          d="m2.5 6.1 2.2 2.2 4.8-5"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-ink-950">
                      {item.title}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-ink-600">
                      {item.copy}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {profile.role === "manager" ? (
            <section className="surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">Your room portfolio</p>
                  <h2 className="mt-2 text-lg font-bold tracking-tight text-ink-950">
                    Scoped by assignment, not by title.
                  </h2>
                </div>
                <StatusChip tone="neutral">
                  {snapshot.assignedRooms.length} active
                </StatusChip>
              </div>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-ink-600">
                These are the rooms that appear in your manager queue. The second
                manager account owns a different set, which makes the boundary
                testable.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {snapshot.assignedRooms.map((room) => (
                  <div
                    key={room.code}
                    className="flex items-center gap-3 rounded-xl border border-sand-200 bg-sand-50 px-3.5 py-3"
                  >
                    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-ink-700 shadow-sm">
                      <svg
                        viewBox="0 0 18 18"
                        fill="none"
                        aria-hidden="true"
                        className="size-4"
                      >
                        <path
                          d="M4 15V6.5h10V15M3 15h12M7 15v-4h4v4"
                          stroke="currentColor"
                          strokeWidth="1.3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M4 6.5 9 3l5 3.5"
                          stroke="currentColor"
                          strokeWidth="1.3"
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-ink-950">
                        {room.name}
                      </p>
                      <p className="mt-0.5 font-mono text-[0.62rem] text-ink-600">
                        {room.code}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {profile.role === "student" ? (
            <section className="surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">Your access scope</p>
                  <h2 className="mt-2 text-lg font-bold tracking-tight text-ink-950">
                    Purposefully narrow.
                  </h2>
                </div>
                <StatusChip tone="neutral">Student</StatusChip>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {[
                  ["Own profile", "Read", true],
                  ["Own requests", "Submit + cancel", true],
                  ["Own access checks", "Simulate", true],
                  ["Own close-out", "Report + complete", true],
                  ["Room policy", "Read", true],
                  ["Manager queue", "Blocked", false],
                  ["Other bookings", "Blocked", false],
                  ["Institution access history", "Blocked", false],
                ].map(([label, state, allowed]) => (
                  <div
                    key={String(label)}
                    className="rounded-xl border border-sand-200 bg-sand-50 p-3"
                  >
                    <p className="text-xs font-semibold text-ink-900">
                      {label}
                    </p>
                    <p
                      className={`mt-1 text-[0.62rem] font-bold uppercase tracking-wider ${
                        allowed ? "text-flag-green" : "text-ink-600/70"
                      }`}
                    >
                      {state}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[0.68rem] leading-4 text-ink-600">
                You can browse rooms, submit requests, follow decisions, simulate
                access, check out with a condition report, and follow your own
                incident through human review.
              </p>
            </section>
          ) : null}

          {profile.role === "admin" ? (
            <section className="surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">Institution snapshot</p>
                  <h2 className="mt-2 text-lg font-bold tracking-tight text-ink-950">
                    Oversight without operational shortcuts.
                  </h2>
                </div>
                <StatusChip tone="amber">Admin scope</StatusChip>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-sand-200 bg-sand-50 p-4">
                  <p className="text-[0.64rem] font-bold uppercase tracking-[0.14em] text-ink-600">
                    Accounts
                  </p>
                  <p className="mt-2 text-sm font-semibold text-ink-950">
                    {snapshot.institutionActiveProfiles} active
                  </p>
                  <p className="mt-1 text-xs text-ink-600">
                    One suspended account is retained for deny-path testing.
                  </p>
                </div>
                <div className="rounded-xl border border-sand-200 bg-sand-50 p-4">
                  <p className="text-[0.64rem] font-bold uppercase tracking-[0.14em] text-ink-600">
                    Audit mode
                  </p>
                  <p className="mt-2 text-sm font-semibold text-ink-950">
                    Append-only
                  </p>
                  <p className="mt-1 text-xs text-ink-600">
                    Access and audit records cannot be edited or deleted by the
                    app.
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          <section className="surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Build sequence</p>
                <h2 className="mt-2 text-lg font-bold tracking-tight text-ink-950">
                  The connected lifecycle comes next.
                </h2>
              </div>
              <span className="font-mono text-[0.62rem] font-semibold text-ink-600">
                PHASE 6
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {roadmap.map((item) => (
                <div
                  key={item.phase}
                  className="rounded-xl border border-sand-200 bg-sand-50 p-4"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[0.62rem] font-bold text-brand-700">
                      {item.phase}
                    </span>
                    <span className="h-px flex-1 bg-sand-200" />
                  </div>
                  <p className="mt-2 text-xs font-semibold text-ink-950">
                    {item.title}
                  </p>
                  <p className="mt-1 text-[0.68rem] leading-5 text-ink-600">
                    {item.detail}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-5">
          <section className="relative overflow-hidden rounded-2xl bg-ink-950 p-5 text-white">
            <div className="grid-paper pointer-events-none absolute inset-0 opacity-70" />
            <div className="relative">
              <div className="flex items-center justify-between gap-3">
                <p className="label text-brand-300">Trust boundary</p>
                <span className="inline-flex size-8 items-center justify-center rounded-full border border-brand-300/20 bg-brand-300/10 text-brand-300">
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                    className="size-4"
                  >
                    <path
                      d="M8 1.75 13 3.9v3.65c0 3.2-2.05 5.5-5 6.7-2.95-1.2-5-3.5-5-6.7V3.9L8 1.75Z"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinejoin="round"
                    />
                    <path
                      d="m5.7 8 1.5 1.5 3-3"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </div>
              <h2 className="mt-4 font-display text-2xl leading-tight tracking-[-0.03em]">
                Enforced by the server.
              </h2>
              <ul className="mt-4 space-y-3">
                {[
                  "HTTP-only signed session cookie",
                  "Role and status re-read on every request",
                  "SQLite is server-only; no client database API",
                  "Access and audit events are append-only",
                ].map((item) => (
                  <li key={item} className="flex gap-2.5 text-xs leading-5 text-white/55">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-brand-300" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3">
                <p className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-white/35">
                  Not yet connected
                </p>
                <p className="mt-1.5 text-xs leading-5 text-white/55">
                  NFC hardware, real door control, and production identity
                  providers are outside this foundation build.
                </p>
              </div>
            </div>
          </section>

          <section className="surface p-5">
            <p className="eyebrow">Signed-in identity</p>
            <div className="mt-4 flex items-center gap-3">
              <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-ink-950 font-mono text-sm font-bold text-brand-300">
                {profile.displayName
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink-950">
                  {profile.displayName}
                </p>
                <p className="mt-0.5 truncate text-xs text-ink-600">
                  {profile.email}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <RoleBadge role={profile.role} />
              <StatusChip tone="green">Active</StatusChip>
            </div>
            <dl className="mt-4 space-y-2.5 border-t border-sand-200 pt-4 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-600">Profile source</dt>
                <dd className="font-semibold text-ink-950">Server database</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-600">Session type</dt>
                <dd className="font-semibold text-ink-950">Signed cookie</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-600">Demo account</dt>
                <dd className="font-mono text-[0.62rem] font-semibold text-ink-950">
                  Yes
                </dd>
              </div>
            </dl>
          </section>

          <section className="surface p-5">
            <p className="eyebrow">Environment</p>
            <dl className="mt-4 space-y-3 text-xs">
              <div>
                <dt className="text-ink-600">Campus timezone</dt>
                <dd className="mt-1 font-mono text-[0.68rem] font-semibold text-ink-950">
                  {timezone}
                </dd>
              </div>
              <div>
                <dt className="text-ink-600">Schema migrations</dt>
                <dd className="mt-1 font-semibold text-ink-950">
                  {snapshot.migrationsApplied} applied
                </dd>
              </div>
              <div>
                <dt className="text-ink-600">Room catalog</dt>
                <dd className="mt-1 font-semibold text-ink-950">
                  {snapshot.activeRooms} active · {snapshot.totalRooms} total
                </dd>
              </div>
            </dl>
            <p className="mt-4 border-t border-sand-200 pt-3.5 text-[0.66rem] leading-4 text-ink-600">
              Demo records are regenerated idempotently. Run{" "}
              <code className="rounded bg-sand-100 px-1 py-0.5 font-mono text-[0.62rem]">
                npm run db:reset
              </code>{" "}
              to refresh relative dates.
            </p>
          </section>
        </div>
      </div>

      <p className="pb-4 text-center text-[0.65rem] leading-5 text-ink-600/80">
        RoomRelay Phase 5 · Complete room lifecycle · Simulated access and no
        physical door control
      </p>
    </div>
  );
}
