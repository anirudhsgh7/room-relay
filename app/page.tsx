import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { ALLOCATION_RULE_COPY, ALLOCATION_RULES } from "@/lib/rooms/policy";

const journey = [
  {
    status: "Waitlisted",
    tone: "bg-flag-amber-bg text-flag-amber",
    when: "Mon 09:12",
    text: "Seminar Room 02 was booked. You're number 1 on the waitlist.",
  },
  {
    status: "In review",
    tone: "bg-sand-100 text-ink-700",
    when: "Tue 14:40",
    text: "The booking holding it was cancelled. Your request went to Marcus.",
  },
  {
    status: "Approved",
    tone: "bg-flag-green-bg text-flag-green",
    when: "Tue 15:05",
    text: "Approved. Please leave the tables in rows.",
  },
  {
    status: "Reminder",
    tone: "bg-brand-50 text-brand-700",
    when: "Thu 15:10",
    text: "Starts at 16:00. Tap your card when you arrive.",
  },
];

const audiences = [
  {
    title: "For students and clubs",
    points: [
      "See which rooms are free for your group, and why others aren't.",
      "Ask in plain words: “a room for 12 tomorrow 2–4pm with a projector”.",
      "Join a waitlist when a time is taken, and get it back automatically.",
      "Reminders before you start and before you need to check out.",
    ],
  },
  {
    title: "For room managers",
    points: [
      "One queue for your rooms, soonest first, with who else wants each time.",
      "Approving one request moves the competing ones to the waitlist and tells them.",
      "Set your rooms' hours, closures, and booking rules yourself.",
      "A nudge when a request starts within a day and nobody has decided.",
    ],
  },
  {
    title: "For administrators",
    points: [
      "Add rooms, assign managers, and close rooms with a clear impact preview.",
      "Every decision, exception, and cancellation is kept with its reason.",
      "Issues reported at check-out go through people, never automatic penalties.",
      "Campus-wide view of what needs attention today.",
    ],
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-sand-50">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" aria-label="RoomRelay home">
          <Wordmark />
        </Link>
        <Link href="/login" className="btn-dark min-h-10 px-4 py-2 text-sm">
          Sign in
        </Link>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pt-8 pb-20 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:pt-16 lg:pb-28">
          <div>
            <h1 className="max-w-xl font-display text-5xl leading-[1.02] tracking-[-0.04em] text-ink-950 sm:text-6xl lg:text-[4.4rem]">
              Book a campus room. Always know where you stand.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-8 text-ink-700">
              Find a free room, send a request, and follow it to the door. When
              two groups want the same time, a published rule decides, and
              everyone can see it.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/login" className="btn-primary">
                Try the demo
              </Link>
              <a href="#fair" className="btn-secondary">
                How requests are ranked
              </a>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-md lg:mr-0">
            <div className="rounded-[1.75rem] bg-ink-950 p-5 text-white shadow-[0_30px_80px_-30px_rgba(6,21,33,0.55)] sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-semibold tracking-tight">Seminar Room 02</p>
                  <p className="mt-0.5 text-sm text-white/60">Thu 29 Oct · 16:00–17:30 · Robotics Club</p>
                </div>
                <span className="rounded-full bg-flag-green-bg px-2.5 py-1 text-xs font-semibold text-flag-green">
                  Approved
                </span>
              </div>
              <ol className="mt-6 space-y-0">
                {journey.map((step, index) => (
                  <li key={step.status} className="relative flex gap-4 pb-5 last:pb-0">
                    {index < journey.length - 1 ? (
                      <span aria-hidden="true" className="absolute top-6 left-[0.6875rem] h-full w-px bg-white/15" />
                    ) : null}
                    <span aria-hidden="true" className="relative mt-1.5 size-[1.375rem] shrink-0 rounded-full border-2 border-brand-300 bg-ink-950" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${step.tone}`}>
                          {step.status}
                        </span>
                        <span className="text-xs text-white/45">{step.when}</span>
                      </div>
                      <p className="mt-1.5 text-sm leading-6 text-white/80">{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section id="fair" className="border-y border-sand-200 bg-white">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
            <h2 className="max-w-2xl font-display text-4xl leading-tight tracking-[-0.03em] text-ink-950">
              Fair when it&apos;s busy, and you can check it.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-ink-700">
              Each room publishes one of three rules. Under all of them,
              requests that already meet the room&apos;s requirements come
              first. A manager who goes out of order has to write down why.
            </p>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {ALLOCATION_RULES.map((rule) => (
                <div key={rule} className="rounded-2xl border border-sand-200 bg-sand-50 p-5">
                  <h3 className="text-lg font-bold text-ink-950">{ALLOCATION_RULE_COPY[rule].label}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink-700">{ALLOCATION_RULE_COPY[rule].short}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
          <div className="grid gap-10 md:grid-cols-3">
            {audiences.map((audience) => (
              <div key={audience.title}>
                <h2 className="text-xl font-bold tracking-tight text-ink-950">{audience.title}</h2>
                <ul className="mt-4 space-y-3">
                  {audience.points.map((point) => (
                    <li key={point} className="border-l-2 border-brand-400 pl-3 text-sm leading-6 text-ink-700">
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-16 flex flex-col items-start justify-between gap-6 rounded-[1.75rem] bg-ink-950 p-7 text-white sm:p-10 lg:flex-row lg:items-center">
            <div>
              <h2 className="font-display text-3xl tracking-[-0.03em] sm:text-4xl">
                See it from each side.
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-white/65">
                Sign in as a student, a room manager, or an administrator. The
                demo accounts are listed on the sign-in page.
              </p>
            </div>
            <Link href="/login" className="btn-primary">
              Choose a demo account
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-sand-200">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Wordmark />
          <p className="max-w-xl text-xs leading-5 text-ink-600">
            RoomRelay is a prototype. Door access is simulated: no card reader
            or lock is connected, and it must not be used to control real
            restricted doors.
          </p>
        </div>
      </footer>
    </div>
  );
}
