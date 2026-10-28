import Link from "next/link";
import { BrandMark, Wordmark } from "@/components/brand";
import { RoleBadge, StatusChip } from "@/components/badges";

const lifecycle = [
  {
    number: "01",
    title: "Discover",
    copy: "Find the right room by time, capacity, building, and facilities.",
  },
  {
    number: "02",
    title: "Request",
    copy: "Submit the purpose, group, and space needed with clear constraints.",
  },
  {
    number: "03",
    title: "Approve",
    copy: "Give room managers a scoped, accountable decision queue.",
  },
  {
    number: "04",
    title: "Access",
    copy: "Connect approved time windows to a trusted server-side check.",
  },
];

const foundation = [
  "Versioned SQLite schema for the full room lifecycle",
  "Server-verified demo sessions and role boundaries",
  "Append-only access and audit event history",
  "Idempotent demo rooms, bookings, and credentials",
];

export default function HomePage() {
  return (
    <div className="min-h-screen overflow-hidden bg-sand-50">
      <header className="relative z-20 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
        <Link href="/" aria-label="RoomRelay home">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-2 sm:gap-3" aria-label="Primary">
          <a
            href="#foundation"
            className="hidden rounded-full px-4 py-2 text-sm font-semibold text-ink-700 transition hover:bg-sand-100 hover:text-ink-950 sm:inline-flex"
          >
            Foundation
          </a>
          <Link href="/login" className="btn-dark min-h-10 px-4 py-2 text-xs sm:text-sm">
            Open the demo
            <svg
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
              className="size-3.5"
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
        </nav>
      </header>

      <main>
        <section className="relative mx-auto max-w-7xl px-5 pb-20 pt-10 sm:px-8 sm:pb-28 sm:pt-16 lg:px-10 lg:pb-32 lg:pt-20">
          <div
            aria-hidden="true"
            className="absolute -right-36 top-0 size-[34rem] rounded-full bg-brand-200/35 blur-3xl"
          />
          <div className="relative grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20">
            <div className="animate-rise">
              <div className="mb-7 flex flex-wrap items-center gap-3">
                <span className="chip border-ink-950/10 bg-white text-ink-700">
                  <span className="size-1.5 rounded-full bg-flag-green" />
                  Phase 5 lifecycle live
                </span>
                <span className="text-xs font-semibold tracking-wide text-ink-600">
                  University room operations
                </span>
              </div>

              <h1 className="max-w-2xl font-display text-[3.25rem] leading-[0.96] tracking-[-0.045em] text-ink-950 sm:text-7xl lg:text-[5.2rem]">
                The room is only
                <span className="block italic text-brand-700">the beginning.</span>
              </h1>

              <p className="mt-7 max-w-xl text-base leading-7 text-ink-700 sm:text-lg sm:leading-8">
                RoomRelay connects room discovery, fair booking, manager
                approval, and time-bound access into one accountable
                workflow—designed for the moment a reservation meets a door.
              </p>

              <div className="mt-9 flex flex-wrap gap-3">
                <Link href="/login" className="btn-primary">
                  Open the demo
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
                <a href="#foundation" className="btn-secondary">
                  See what is ready
                </a>
              </div>

              <p className="mt-7 flex items-start gap-2 text-xs leading-5 text-ink-600">
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0 text-brand-700"
                >
                  <path
                    d="M8 1.75 13 3.9v3.65c0 3.2-2.05 5.5-5 6.7-2.95-1.2-5-3.5-5-6.7V3.9L8 1.75Z"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                  />
                </svg>
                Discovery, decisions, simulated access, check-out, incidents,
                and a connected lifecycle timeline are live.
              </p>
            </div>

            <div className="animate-rise-late relative mx-auto w-full max-w-lg lg:mr-0">
              <div className="absolute -inset-4 -z-10 rotate-2 rounded-[2rem] border border-sand-200 bg-sand-100/70" />
              <div className="relative overflow-hidden rounded-[1.75rem] bg-ink-950 p-5 text-white shadow-[0_30px_80px_-30px_rgba(6,21,33,0.55)] sm:p-7">
                <div className="grid-paper pointer-events-none absolute inset-0 opacity-80" />
                <div className="relative">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2.5">
                      <BrandMark tone="dark" size="sm" />
                      <div>
                        <p className="text-[0.63rem] font-bold uppercase tracking-[0.18em] text-brand-300">
                          RoomRelay foundation
                        </p>
                        <p className="mt-0.5 text-xs text-white/55">
                          Trusted workflow map
                        </p>
                      </div>
                    </div>
                    <span className="rounded-full border border-white/15 px-2.5 py-1 text-[0.63rem] font-semibold uppercase tracking-wider text-white/60">
                      Phase 01
                    </span>
                  </div>

                  <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.055] p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[0.62rem] font-bold uppercase tracking-[0.16em] text-white/40">
                          Demo room
                        </p>
                        <p className="mt-1 text-lg font-semibold tracking-tight">
                          Seminar Room 02
                        </p>
                        <p className="mt-0.5 text-xs text-white/55">
                          Hazelwood Hall · 18 seats
                        </p>
                      </div>
                      <StatusChip tone="amber">Pending</StatusChip>
                    </div>
                    <div className="mt-5 flex items-center gap-2 border-t border-white/10 pt-4 text-xs text-white/55">
                      <span className="font-mono text-[0.67rem] text-brand-300">
                        16:00–17:30
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>Robotics Club</span>
                    </div>
                  </div>

                  <div className="mt-5 space-y-2.5">
                    {[
                      ["Identity and session", "Ready", "green"],
                      ["Room discovery", "Live", "green"],
                      ["Pending requests", "Live", "green"],
                      ["Manager decisions", "Live", "green"],
                      ["Simulated access check", "Live", "green"],
                      ["Check-out and incidents", "Live", "green"],
                      ["Submission hardening", "Next phase", "neutral"],
                    ].map(([label, status, tone]) => (
                      <div
                        key={label}
                        className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.075] bg-white/[0.035] px-3.5 py-2.5"
                      >
                        <span className="text-xs text-white/70">{label}</span>
                        <span
                          className={`text-[0.62rem] font-bold uppercase tracking-wider ${
                            tone === "green"
                              ? "text-brand-300"
                              : "text-white/35"
                          }`}
                        >
                          {status}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 flex items-center gap-3 rounded-xl border border-brand-300/20 bg-brand-300/[0.08] px-3.5 py-3">
                    <span className="relative flex size-2.5 shrink-0">
                      <span className="pulse-soft absolute inline-flex size-full rounded-full bg-brand-300" />
                      <span className="relative inline-flex size-2.5 rounded-full bg-brand-300" />
                    </span>
                    <p className="text-[0.68rem] leading-4 text-white/65">
                      Permissions resolved on the server—not from the browser.
                    </p>
                  </div>
                </div>
              </div>

              <div className="absolute -bottom-7 -left-3 hidden rotate-[-3deg] rounded-xl border border-sand-200 bg-white px-4 py-3 shadow-lg sm:block">
                <p className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-ink-600">
                  Audit trail
                </p>
                <p className="mt-1 text-xs font-semibold text-ink-900">
                  Every decision has a record.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section
          id="foundation"
          className="border-y border-sand-200 bg-white/65"
        >
          <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20 lg:px-10 lg:py-24">
            <div>
              <p className="eyebrow">Phase 1 · Foundation</p>
              <h2 className="mt-4 max-w-md font-display text-4xl leading-tight tracking-[-0.035em] text-ink-950 sm:text-5xl">
                A trustworthy base for the whole lifecycle.
              </h2>
              <p className="mt-5 max-w-md text-sm leading-6 text-ink-700">
                This build establishes identity, role scope, the data model, and
                the append-only history that every later workflow depends on. It
                deliberately stops short of pretending the booking flow already
                works.
              </p>
              <div className="mt-7">
                <Link href="/login" className="btn-primary">
                  Try a demo role
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
              </div>
            </div>

            <div className="surface overflow-hidden">
              <div className="flex items-center justify-between border-b border-sand-200 px-5 py-4 sm:px-6">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-flag-green" />
                  <span className="text-xs font-bold uppercase tracking-[0.14em] text-ink-700">
                    Foundation status
                  </span>
                </div>
                <span className="font-mono text-[0.65rem] text-ink-600">
                  BUILD 01
                </span>
              </div>
              <ul className="divide-y divide-sand-200">
                {foundation.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3.5 px-5 py-4 sm:px-6"
                  >
                    <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-flag-green-bg text-flag-green">
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
                    </span>
                    <span className="text-sm leading-6 text-ink-800">{item}</span>
                  </li>
                ))}
              </ul>
              <div className="border-t border-sand-200 bg-sand-50 px-5 py-4 sm:px-6">
                <p className="text-xs leading-5 text-ink-600">
                  Check-out condition reports and incidents feed a human-reviewed
                  lifecycle. No automatic penalties or physical door control.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:px-10 lg:py-24">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="eyebrow">One connected loop</p>
              <h2 className="mt-4 max-w-2xl font-display text-4xl leading-tight tracking-[-0.035em] text-ink-950 sm:text-5xl">
                More than a room calendar.
              </h2>
            </div>
            <p className="max-w-sm text-sm leading-6 text-ink-600">
              Every step is designed to answer who asked, who approved, whether
              access was granted, and what happened afterwards.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {lifecycle.map((step) => (
              <article
                key={step.number}
                className="group relative overflow-hidden rounded-2xl border border-sand-200 bg-white p-5 transition duration-300 hover:-translate-y-1 hover:border-ink-950/20 hover:shadow-lg"
              >
                <span className="font-mono text-[0.65rem] font-semibold text-brand-700">
                  {step.number}
                </span>
                <h3 className="mt-8 text-lg font-bold tracking-tight text-ink-950">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-ink-600">{step.copy}</p>
                <span className="absolute right-5 top-5 size-8 rounded-full border border-sand-200 bg-sand-50 transition group-hover:border-brand-300 group-hover:bg-brand-50" />
              </article>
            ))}
          </div>

          <div className="mt-16 grid gap-4 rounded-[1.75rem] bg-ink-950 p-6 text-white sm:p-9 lg:grid-cols-[1fr_auto] lg:items-center lg:p-11">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-brand-300">
                  Demo access
                </span>
                <RoleBadge role="student" compact />
                <RoleBadge role="manager" compact />
                <RoleBadge role="admin" compact />
              </div>
              <h2 className="mt-4 max-w-2xl font-display text-3xl leading-tight tracking-[-0.03em] sm:text-4xl">
                Step into the workspace and verify the trust boundary yourself.
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-white/55">
                Sign in as a student, manager, or administrator. No email, no
                external identity provider, no hardware.
              </p>
            </div>
            <Link
              href="/login"
              className="btn-primary mt-6 w-full sm:w-auto lg:mt-0"
            >
              View demo accounts
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-sand-200 bg-sand-100/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <Wordmark />
          <p className="max-w-xl text-xs leading-5 text-ink-600">
            RoomRelay is a university hackathon prototype. It is not authorised
            for controlling real restricted doors. NFC access remains an
            optional hardware layer.
          </p>
          <p className="text-xs font-semibold text-ink-700">Phase 5 · 2026</p>
        </div>
      </footer>
    </div>
  );
}
