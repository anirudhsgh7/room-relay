import {
  formatCampusDate,
  formatCampusTime,
} from "@/lib/time/campus-time";
import type {
  BookingTimeline,
  TimelineEntryKind,
} from "@/lib/bookings/timeline";

const kindStyles: Record<TimelineEntryKind, string> = {
  request: "bg-sand-100 text-ink-700",
  decision: "bg-brand-50 text-brand-700",
  access: "bg-ink-950 text-brand-300",
  condition: "bg-flag-amber-bg text-flag-amber",
  incident: "bg-flag-red-bg text-flag-red",
  completion: "bg-flag-green-bg text-flag-green",
};

export function LifecycleTimeline({
  timeline,
  timezone,
}: {
  timeline: BookingTimeline;
  timezone: string;
}) {
  return (
    <section className="surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Lifecycle history</p>
          <h2 className="mt-2 text-lg font-bold tracking-tight text-ink-950">
            From request to close-out
          </h2>
        </div>
        <span className="font-mono text-[0.62rem] text-ink-600">
          {timeline.entries.length} events
        </span>
      </div>

      {timeline.entries.length > 0 ? (
        <ol className="mt-5 space-y-0">
          {timeline.entries.map((entry, index) => (
            <li key={entry.id} className="relative flex gap-3.5 pb-5 last:pb-0">
              {index < timeline.entries.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="absolute left-[0.68rem] top-7 h-[calc(100%-1.1rem)] w-px bg-sand-200"
                />
              ) : null}
              <span
                className={`relative z-10 mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full ${kindStyles[entry.kind]}`}
              >
                <span className="size-1.5 rounded-full bg-current" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <p className="text-xs font-semibold text-ink-950">
                    {entry.title}
                  </p>
                  <p className="text-[0.62rem] text-ink-600">
                    {formatCampusDate(entry.occurredAt, timezone)}{" "}
                    {formatCampusTime(entry.occurredAt, timezone)}
                  </p>
                </div>
                <p className="mt-1 text-xs leading-5 text-ink-600">
                  {entry.description}
                </p>
                {entry.actorName ? (
                  <p className="mt-1 text-[0.62rem] text-ink-600/80">
                    {entry.actorName}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 rounded-xl border border-sand-200 bg-sand-50 p-4 text-sm text-ink-600">
          No lifecycle events are recorded yet.
        </p>
      )}
    </section>
  );
}
