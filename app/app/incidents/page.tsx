import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusChip } from "@/components/badges";
import { requireCurrentProfile } from "@/lib/auth/session";
import { getDatabase } from "@/lib/db/client";
import {
  listIncidents,
  parseIncidentFilters,
  type IncidentQueueFilters,
} from "@/lib/incidents/queries";
import {
  INCIDENT_CATEGORIES,
  INCIDENT_CATEGORY_LABELS,
} from "@/lib/incidents/constants";

export const metadata: Metadata = {
  title: "Incidents",
  description: "Room-scoped condition incidents awaiting review.",
};

function queryFor(
  filters: IncidentQueueFilters,
  overrides: Partial<IncidentQueueFilters> = {},
): string {
  const values = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (values.status !== "active") params.set("status", values.status);
  if (values.roomCode) params.set("room", values.roomCode);
  if (values.category) params.set("category", values.category);
  if (values.date) params.set("date", values.date);
  if (values.page > 1) params.set("page", String(values.page));
  return params.toString();
}

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireCurrentProfile();

  if (profile.role !== "manager" && profile.role !== "admin") {
    notFound();
  }

  const raw = await searchParams;
  const parsed = parseIncidentFilters(raw);
  const result = listIncidents(getDatabase(), profile, parsed.filters);
  const isAdmin = profile.role === "admin";

  return (
    <div className="space-y-7">
      <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusChip tone="neutral">
              {isAdmin ? "All rooms" : "Your rooms"}
            </StatusChip>
          </div>
          <h1 className="mt-3 font-display text-4xl leading-[1.03] tracking-[-0.04em] text-ink-950 sm:text-5xl">
            Reported issues
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-ink-700">
            Problems people reported when they checked out. A report isn&apos;t
            a finding of fault: the room manager reviews it first, then an
            administrator records the outcome. Nothing is penalised
            automatically.
          </p>
        </div>
        <div className="surface shrink-0 px-4 py-3">
          <p className="text-sm font-semibold text-ink-600">
            Still open
          </p>
          <p className="mt-1 font-display text-3xl leading-none tracking-[-0.03em] text-ink-950">
            {result.counts.open + result.counts.reviewing}
          </p>
          <p className="mt-1.5 text-xs text-ink-600">
            new or being reviewed
          </p>
        </div>
      </section>

      <section className="surface overflow-hidden">
        <div className="border-b border-sand-200 px-4 pt-4 sm:px-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-ink-950">Incident queue</p>
              <p className="mt-1 text-xs text-ink-600">
                Oldest reports appear first within the active view.
              </p>
            </div>
            <span className="font-mono text-[0.62rem] text-ink-600">
              {result.total} matching
            </span>
          </div>
          <nav
            className="mt-4 flex gap-1 overflow-x-auto"
            aria-label="Incident status"
          >
            {[
              ["active", "Active", result.counts.open + result.counts.reviewing],
              ["open", "Open", result.counts.open],
              ["reviewing", "Reviewing", result.counts.reviewing],
              ["resolved", "Resolved", result.counts.resolved],
              ["all", "All", result.counts.open + result.counts.reviewing + result.counts.resolved],
            ].map(([value, label, count]) => (
              <Link
                key={String(value)}
                href={`/app/incidents?${queryFor(parsed.filters, {
                  status: value as IncidentQueueFilters["status"],
                  page: 1,
                })}`}
                aria-current={
                  parsed.filters.status === value ? "page" : undefined
                }
                className={`whitespace-nowrap rounded-t-lg border-b-2 px-3 pb-2.5 pt-2 text-xs font-semibold transition ${
                  parsed.filters.status === value
                    ? "border-brand-600 text-ink-950"
                    : "border-transparent text-ink-600 hover:text-ink-950"
                }`}
              >
                {label}
                <span className="ml-1.5 rounded-full bg-sand-100 px-1.5 py-0.5 font-mono text-[0.6rem] text-ink-700">
                  {count}
                </span>
              </Link>
            ))}
          </nav>
        </div>

        <form
          method="get"
          action="/app/incidents"
          className="grid gap-3 border-b border-sand-200 bg-sand-50/70 px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-12"
        >
          <input type="hidden" name="status" value={parsed.filters.status} />
          <div className="lg:col-span-3">
            <label
              htmlFor="room"
              className="mb-1.5 block text-xs font-semibold text-ink-800"
            >
              Room
            </label>
            <select
              id="room"
              name="room"
              defaultValue={parsed.filters.roomCode}
              className="field"
            >
              <option value="">All visible rooms</option>
              {result.rooms.map((room) => (
                <option key={room.code} value={room.code}>
                  {room.name}
                </option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-3">
            <label
              htmlFor="category"
              className="mb-1.5 block text-xs font-semibold text-ink-800"
            >
              Category
            </label>
            <select
              id="category"
              name="category"
              defaultValue={parsed.filters.category}
              className="field"
            >
              <option value="">All categories</option>
              {INCIDENT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {INCIDENT_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-2">
            <label
              htmlFor="date"
              className="mb-1.5 block text-xs font-semibold text-ink-800"
            >
              Reported date
            </label>
            <input
              id="date"
              name="date"
              type="date"
              defaultValue={parsed.filters.date}
              className="field"
            />
          </div>
          <div className="flex items-end lg:col-span-2">
            <button type="submit" className="btn-dark w-full">
              Filter
            </button>
          </div>
          <div className="flex items-end justify-end lg:col-span-2">
            {queryFor(parsed.filters) ? (
              <Link
                href="/app/incidents"
                className="text-xs font-semibold text-brand-700 hover:text-brand-600"
              >
                Clear
              </Link>
            ) : null}
          </div>
        </form>

        {parsed.error ? (
          <div
            role="alert"
            className="border-b border-flag-amber/20 bg-flag-amber-bg px-4 py-3 text-sm text-flag-amber sm:px-5"
          >
            {parsed.error}
          </div>
        ) : null}

        {result.items.length > 0 ? (
          <ul className="divide-y divide-sand-200">
            {result.items.map((incident) => (
              <li key={incident.id}>
                <Link
                  href={`/app/incidents/${incident.id}`}
                  className="group grid gap-3 px-4 py-4 transition hover:bg-sand-50 sm:px-5 lg:grid-cols-[1.15fr_1fr_1.4fr_auto] lg:items-center"
                >
                  <div>
                    <p className="text-sm font-bold text-ink-950 group-hover:text-brand-700">
                      {incident.roomName}
                    </p>
                    <p className="mt-0.5 text-[0.65rem] text-ink-600">
                      {incident.requesterName} · {incident.roomCode}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-ink-900">
                      {incident.categoryLabel}
                    </p>
                    <p className="mt-0.5 text-[0.65rem] text-ink-600">
                      {incident.createdDateLabel}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-xs leading-5 text-ink-700">
                      {incident.description}
                    </p>
                    <p className="mt-1 text-[0.62rem] text-ink-600">
                      Booking {incident.bookingStatus.replaceAll("_", " ")}
                    </p>
                  </div>
                  <StatusChip
                    tone={
                      incident.status === "open"
                        ? "red"
                        : incident.status === "reviewing"
                          ? "amber"
                          : "green"
                    }
                  >
                    {incident.statusLabel}
                  </StatusChip>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-6 py-14 text-center">
            <h2 className="text-base font-bold text-ink-950">
              No incidents match.
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-600">
              Try another room, category, date, or status.
            </p>
          </div>
        )}

        {result.total > result.pageSize ? (
          <div className="flex items-center justify-between gap-3 border-t border-sand-200 px-4 py-3 sm:px-5">
            <p className="text-xs text-ink-600">
              Page {result.page} of {Math.ceil(result.total / result.pageSize)}
            </p>
            <div className="flex gap-2">
              {result.page > 1 ? (
                <Link
                  href={`/app/incidents?${queryFor(parsed.filters, {
                    page: result.page - 1,
                  })}`}
                  className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
                >
                  Previous
                </Link>
              ) : null}
              {result.page < Math.ceil(result.total / result.pageSize) ? (
                <Link
                  href={`/app/incidents?${queryFor(parsed.filters, {
                    page: result.page + 1,
                  })}`}
                  className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
                >
                  Next
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      <p className="text-center text-[0.65rem] leading-5 text-ink-600/80">
        A reported issue is not an automatic penalty. Final operational decisions
        require a human administrator.
      </p>
    </div>
  );
}
