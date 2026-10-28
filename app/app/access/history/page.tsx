import type { Metadata } from "next";
import Link from "next/link";
import { StatusChip } from "@/components/badges";
import {
  listAccessHistory,
  parseAccessHistoryFilters,
  type AccessHistoryFilters,
} from "@/lib/access/queries";
import { ACCESS_REASON_MESSAGES } from "@/lib/access/types";
import { requireCurrentProfile } from "@/lib/auth/session";
import { getDatabase } from "@/lib/db/client";

export const metadata: Metadata = {
  title: "Access history",
  description: "Role-scoped simulated room access attempts.",
};

const reasonOptions = Object.keys(ACCESS_REASON_MESSAGES);

function queryFor(
  filters: AccessHistoryFilters,
  overrides: Partial<AccessHistoryFilters> = {},
): string {
  const values = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (values.roomCode) params.set("room", values.roomCode);
  if (values.result !== "all") params.set("result", values.result);
  if (values.reasonCode) params.set("reason", values.reasonCode);
  if (values.date) params.set("date", values.date);
  if (values.page > 1) params.set("page", String(values.page));
  return params.toString();
}

export default async function AccessHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireCurrentProfile();
  const raw = await searchParams;
  const parsed = parseAccessHistoryFilters(raw);
  const result = listAccessHistory(getDatabase(), profile, parsed.filters);
  const isStudent = profile.role === "student";
  const isAdmin = profile.role === "admin";

  return (
    <div className="space-y-7">
      <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <p className="eyebrow">Access history · Phase 4</p>
            <StatusChip tone="neutral">
              {isAdmin
                ? "Institution-wide"
                : isStudent
                  ? "Your attempts"
                  : "Assigned rooms"}
            </StatusChip>
          </div>
          <h1 className="mt-3 font-display text-4xl leading-[1.03] tracking-[-0.04em] text-ink-950 sm:text-5xl">
            {isAdmin
              ? "Institution access log."
              : isStudent
                ? "Your access attempts."
                : "Room access activity."}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-ink-700">
            {isStudent
              ? "Only attempts made by your own account appear here. Raw credential references are never displayed."
              : isAdmin
                ? "Every room access attempt is visible in this institution-wide, append-only log."
                : "Only attempts for rooms assigned to you appear here. Scope is enforced by the server."}
          </p>
        </div>
        <Link href="/app/access" className="btn-secondary shrink-0">
          Back to simulator
        </Link>
      </section>

      <section className="surface overflow-hidden">
        <form
          method="get"
          action="/app/access/history"
          className="grid gap-3 border-b border-sand-200 bg-sand-50/70 px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-12"
        >
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
          <div className="lg:col-span-2">
            <label
              htmlFor="result"
              className="mb-1.5 block text-xs font-semibold text-ink-800"
            >
              Result
            </label>
            <select
              id="result"
              name="result"
              defaultValue={parsed.filters.result}
              className="field"
            >
              <option value="all">All results</option>
              <option value="allowed">Allowed</option>
              <option value="denied">Denied</option>
            </select>
          </div>
          <div className="lg:col-span-2">
            <label
              htmlFor="date"
              className="mb-1.5 block text-xs font-semibold text-ink-800"
            >
              Date
            </label>
            <input
              id="date"
              name="date"
              type="date"
              defaultValue={parsed.filters.date}
              className="field"
            />
          </div>
          <div className="lg:col-span-3">
            <label
              htmlFor="reason"
              className="mb-1.5 block text-xs font-semibold text-ink-800"
            >
              Reason
            </label>
            <select
              id="reason"
              name="reason"
              defaultValue={parsed.filters.reasonCode}
              className="field"
            >
              <option value="">All reasons</option>
              {reasonOptions.map((reason) => (
                <option key={reason} value={reason}>
                  {ACCESS_REASON_MESSAGES[reason]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end lg:col-span-2">
            <button type="submit" className="btn-dark w-full">
              Filter
            </button>
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sand-200 px-4 py-2.5 sm:px-5">
          <p className="text-[0.65rem] text-ink-600">
            {result.total} {result.total === 1 ? "attempt" : "attempts"} ·
            newest first
          </p>
          {parsed.error ? (
            <p role="alert" className="text-xs text-flag-amber">
              {parsed.error}
            </p>
          ) : null}
          {queryFor(parsed.filters) ? (
            <Link
              href="/app/access/history"
              className="text-xs font-semibold text-brand-700 hover:text-brand-600"
            >
              Clear filters
            </Link>
          ) : null}
        </div>

        {result.items.length > 0 ? (
          <ul className="divide-y divide-sand-200">
            {result.items.map((event) => (
              <li
                key={event.id}
                className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[1.15fr_0.9fr_1.5fr_auto] lg:items-center"
              >
                <div>
                  <p className="text-sm font-bold text-ink-950">
                    {event.roomName}
                  </p>
                  <p className="mt-0.5 text-[0.65rem] text-ink-600">
                    {event.building} · {event.roomCode}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-ink-900">
                    {event.dateLabel} · {event.timeLabel}
                  </p>
                  <p className="mt-0.5 text-[0.65rem] text-ink-600">
                    {event.actorName ?? "Unknown actor"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs leading-5 text-ink-700">
                    {event.reasonMessage}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[0.62rem] text-ink-600">
                    <span className="font-mono">{event.reasonCode}</span>
                    {event.credentialLabel ? (
                      <span>{event.credentialLabel}</span>
                    ) : null}
                    <span>
                      {event.source === "simulator"
                        ? "Simulated"
                        : event.source === "reader"
                          ? "Reader"
                          : "Seed fixture"}
                    </span>
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
          <div className="px-6 py-14 text-center">
            <h2 className="text-base font-bold text-ink-950">
              No access attempts match.
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-600">
              {isStudent
                ? "Run a simulated access check to create your first access event."
                : "Try another room, result, reason, or date."}
            </p>
            {isStudent ? (
              <Link href="/app/access" className="btn-primary mt-5">
                Open simulator
              </Link>
            ) : null}
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
                  href={`/app/access/history?${queryFor(parsed.filters, {
                    page: result.page - 1,
                  })}`}
                  className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
                >
                  Previous
                </Link>
              ) : null}
              {result.page < Math.ceil(result.total / result.pageSize) ? (
                <Link
                  href={`/app/access/history?${queryFor(parsed.filters, {
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
        Access events are append-only. This page reports decisions from the
        software simulator; it does not represent physical door activity.
      </p>
    </div>
  );
}
