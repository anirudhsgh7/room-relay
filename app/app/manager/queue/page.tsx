import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingStatusChip, StatusChip } from "@/components/badges";
import { requireCurrentProfile } from "@/lib/auth/session";
import {
  listManagerQueue,
  parseManagerQueueFilters,
  type ManagerQueueFilters,
  type ManagerQueueStatus,
} from "@/lib/bookings/manager-queries";
import { getCampusTimezone } from "@/lib/config";
import { getDatabase } from "@/lib/db/client";
import { formatCampusDate, formatCampusTime } from "@/lib/time/campus-time";

export const metadata: Metadata = {
  title: "Requests to review",
  description: "Review room requests for the rooms you manage.",
};

const statusTabs: Array<{ status: ManagerQueueStatus; label: string }> = [
  { status: "pending", label: "To review" },
  { status: "waitlisted", label: "Waitlisted" },
  { status: "approved", label: "Approved" },
  { status: "rejected", label: "Declined" },
  { status: "cancelled", label: "Cancelled" },
];

function queryFor(
  filters: ManagerQueueFilters,
  overrides: Partial<ManagerQueueFilters> = {},
): string {
  const values = { ...filters, ...overrides };
  const params = new URLSearchParams();
  params.set("status", values.status);
  if (values.roomCode) params.set("room", values.roomCode);
  if (values.date) params.set("date", values.date);
  if (values.eligibility !== "all") {
    params.set("eligibility", values.eligibility);
  }
  if (values.conflict !== "all") params.set("conflict", values.conflict);
  if (values.page > 1) params.set("page", String(values.page));
  return params.toString();
}

export default async function ManagerQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireCurrentProfile();

  if (profile.role !== "manager" && profile.role !== "admin") {
    notFound();
  }

  const raw = await searchParams;
  const parsedFilters = parseManagerQueueFilters(raw);
  const result = await listManagerQueue(
    getDatabase(),
    profile,
    parsedFilters.filters,
  );
  const timezone = getCampusTimezone();
  const activeTab = parsedFilters.filters.status;

  return (
    <div className="space-y-7">
      <section>
        <h1 className="font-display text-4xl leading-tight tracking-[-0.03em] text-ink-950 sm:text-5xl">
          Requests to review
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-700 sm:text-base sm:leading-7">
          {profile.role === "admin"
            ? "Every room on campus. Decisions you make are recorded under your name."
            : "Requests for the rooms you manage, oldest first. When several people want the same time, each request shows its place under the room's published rule."}
        </p>
      </section>

      <section className="surface overflow-hidden" aria-labelledby="queue-heading">
        <div className="border-b border-sand-200 px-4 pt-4 sm:px-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="queue-heading" className="text-base font-bold text-ink-950">
                {result.total} {result.total === 1 ? "request" : "requests"}
              </h2>
              <p className="mt-1 text-sm text-ink-600">
                A request holds nothing until it is approved.
              </p>
            </div>
          </div>
          <nav
            className="mt-4 flex gap-1 overflow-x-auto"
            aria-label="Request status"
          >
            {statusTabs.map((tab) => (
              <Link
                key={tab.status}
                href={`/app/manager/queue?${queryFor(parsedFilters.filters, {
                  status: tab.status,
                  page: 1,
                })}`}
                aria-current={activeTab === tab.status ? "page" : undefined}
                className={`whitespace-nowrap rounded-t-lg border-b-2 px-3 pb-2.5 pt-2 text-sm font-semibold transition ${
                  activeTab === tab.status
                    ? "border-brand-600 text-ink-950"
                    : "border-transparent text-ink-600 hover:text-ink-950"
                }`}
              >
                {tab.label}
                <span className="ml-1.5 rounded-full bg-sand-100 px-1.5 py-0.5 text-xs tabular-nums text-ink-700">
                  {result.counts[tab.status]}
                </span>
              </Link>
            ))}
          </nav>
        </div>

        <form
          method="get"
          action="/app/manager/queue"
          className="grid gap-3 border-b border-sand-200 bg-sand-50/70 px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-12"
        >
          <input type="hidden" name="status" value={parsedFilters.filters.status} />
          <div className="lg:col-span-3">
            <label htmlFor="room" className="mb-1.5 block text-xs font-semibold text-ink-800">
              Room
            </label>
            <select
              id="room"
              name="room"
              defaultValue={parsedFilters.filters.roomCode}
              className="field"
            >
              <option value="">All assigned rooms</option>
              {result.rooms.map((room) => (
                <option key={room.code} value={room.code}>
                  {room.name}
                </option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-2">
            <label htmlFor="date" className="mb-1.5 block text-xs font-semibold text-ink-800">
              Request date
            </label>
            <input
              id="date"
              name="date"
              type="date"
              defaultValue={parsedFilters.filters.date}
              className="field"
            />
          </div>
          <div className="lg:col-span-3">
            <label
              htmlFor="eligibility"
              className="mb-1.5 block text-xs font-semibold text-ink-800"
            >
              Requirements
            </label>
            <select
              id="eligibility"
              name="eligibility"
              defaultValue={parsedFilters.filters.eligibility}
              className="field"
            >
              <option value="all">All requests</option>
              <option value="needs_review">Requirements not met yet</option>
            </select>
          </div>
          <div className="lg:col-span-2">
            <label
              htmlFor="conflict"
              className="mb-1.5 block text-xs font-semibold text-ink-800"
            >
              Competition
            </label>
            <select
              id="conflict"
              name="conflict"
              defaultValue={parsedFilters.filters.conflict}
              className="field"
            >
              <option value="all">All requests</option>
              <option value="any">Competes for its time</option>
            </select>
          </div>
          <div className="flex items-end lg:col-span-2">
            <button type="submit" className="btn-dark w-full">
              Filter
            </button>
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sand-200 px-4 py-2.5 sm:px-5">
          <p className="text-xs text-ink-600">
            Oldest request first. Times are campus time.
          </p>
          {parsedFilters.filters.roomCode ||
          parsedFilters.filters.date ||
          parsedFilters.filters.eligibility !== "all" ||
          parsedFilters.filters.conflict !== "all" ? (
            <Link
              href={`/app/manager/queue?status=${activeTab}`}
              className="text-xs font-semibold text-brand-700 hover:text-brand-600"
            >
              Clear filters
            </Link>
          ) : null}
        </div>

        {parsedFilters.error ? (
          <div
            role="alert"
            className="border-b border-flag-amber/20 bg-flag-amber-bg px-4 py-3 text-sm text-flag-amber sm:px-5"
          >
            {parsedFilters.error}
          </div>
        ) : null}

        {result.items.length > 0 ? (
          <ul className="divide-y divide-sand-200">
            {result.items.map((request) => (
              <li key={request.id}>
                <Link
                  href={`/app/manager/requests/${request.id}`}
                  className="group grid gap-4 px-4 py-4 transition hover:bg-sand-50 sm:px-5 lg:grid-cols-[1.2fr_1.1fr_1fr_auto] lg:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-ink-950 group-hover:text-brand-700">
                        {request.roomName}
                      </p>
                      <BookingStatusChip status={request.status} />
                    </div>
                    <p className="mt-1 text-xs text-ink-600">
                      {request.requesterName} · {request.building} · {request.roomCode}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-ink-900">
                      {request.dateLabel} · {request.timeLabel}
                    </p>
                    <p className="mt-1 text-[0.65rem] text-ink-600">
                      {request.groupName ?? "No group"} · {request.expectedAttendance}/
                      {request.capacity} attending
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs text-ink-700">
                      {request.purpose}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {request.outstandingRequirementCount > 0 ? (
                        <StatusChip tone="amber">Check requirements</StatusChip>
                      ) : (
                        <StatusChip tone="green">Meets requirements</StatusChip>
                      )}
                      {request.status === "pending" &&
                      request.pendingOverlapCount > 0 ? (
                        <StatusChip tone="amber">
                          {request.pendingOverlapCount + 1} want this time
                        </StatusChip>
                      ) : null}
                      {request.hasConfirmedConflict ? (
                        <StatusChip tone="red">Time already booked</StatusChip>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 lg:justify-end">
                    <span className="text-[0.62rem] text-ink-600">
                      Received{" "}
                      {formatCampusDate(request.createdAt, timezone)}{" "}
                      {formatCampusTime(request.createdAt, timezone)}
                    </span>
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                      className="size-4 text-ink-600 transition group-hover:translate-x-0.5 group-hover:text-brand-700"
                    >
                      <path
                        d="M3.5 8h9M9 4.5 12.5 8 9 11.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-sand-100 text-ink-700">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                className="size-5"
              >
                <path
                  d="M5 6.5h14v12H5v-12ZM8 6.5V5h8v1.5M8 11h8M8 15h5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <h2 className="mt-4 text-base font-bold text-ink-950">
              {parsedFilters.filters.status === "pending"
                ? "Nothing to review."
                : "No requests in this view."}
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-ink-600">
              {result.rooms.length === 0
                ? "You do not have any rooms assigned yet."
                : "Try another room, date, eligibility filter, or status tab."}
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
                  href={`/app/manager/queue?${queryFor(parsedFilters.filters, {
                    page: result.page - 1,
                  })}`}
                  className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
                >
                  Previous
                </Link>
              ) : null}
              {result.page < Math.ceil(result.total / result.pageSize) ? (
                <Link
                  href={`/app/manager/queue?${queryFor(parsedFilters.filters, {
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
        Queue scope is enforced on the server. Approval allocates a booking; it
        does not prove physical room access.
      </p>
    </div>
  );
}
