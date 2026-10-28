import type { Metadata } from "next";
import Link from "next/link";
import { StatusChip } from "@/components/badges";
import { requireCurrentProfile } from "@/lib/auth/session";
import { getDatabase } from "@/lib/db/client";
import {
  getRoomFilterOptions,
  searchRooms,
} from "@/lib/rooms/queries";
import {
  parseRoomSearchParams,
  toRoomSearchQuery,
} from "@/lib/rooms/search";
import type { RoomAvailabilityCode, RoomSummary } from "@/lib/rooms/types";

export const metadata: Metadata = {
  title: "Room discovery",
  description: "Find an available campus room and submit a booking request.",
};

function availabilityChip(code: RoomAvailabilityCode | null) {
  switch (code) {
    case "available":
      return <StatusChip tone="green">Available for request</StatusChip>;
    case "conflict":
      return <StatusChip tone="red">Booked at this time</StatusChip>;
    case "outside_hours":
      return <StatusChip tone="amber">Outside room hours</StatusChip>;
    case "invalid_time":
      return <StatusChip tone="amber">Check time rules</StatusChip>;
    case "not_requestable":
      return <StatusChip tone="neutral">Not taking requests</StatusChip>;
    default:
      return <StatusChip tone="neutral">View room</StatusChip>;
  }
}

function RoomCard({
  room,
  query,
  role,
}: {
  room: RoomSummary;
  query: string;
  role: "student" | "manager" | "admin";
}) {
  const detailHref = `/app/rooms/${encodeURIComponent(room.code)}${
    query ? `?${query}` : ""
  }`;

  return (
    <article className="surface group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:border-ink-950/20 hover:shadow-lg">
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.13em] text-ink-600">
              {room.code}
            </p>
            <h2 className="mt-1.5 text-lg font-bold tracking-tight text-ink-950">
              <Link href={detailHref} className="hover:text-brand-700">
                {room.name}
              </Link>
            </h2>
            <p className="mt-1 text-xs text-ink-600">
              {room.building} · {room.location}
            </p>
          </div>
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <svg
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
              className="size-4"
            >
              <path
                d="M4.5 16.5v-9L10 3.5l5.5 4v9M3.5 16.5h13M8 16.5v-4h4v4"
                stroke="currentColor"
                strokeWidth="1.35"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {availabilityChip(room.availability)}
          <span className="chip border-ink-950/10 bg-sand-50 text-ink-700">
            {room.capacity} seats
          </span>
          {room.requiredRequirementCount > 0 ? (
            role === "student" ? (
              room.hasUnverifiedRequiredRequirement ? (
                <StatusChip tone="amber">Eligibility review needed</StatusChip>
              ) : (
                <StatusChip tone="green">Requirements verified</StatusChip>
              )
            ) : (
              <StatusChip tone="neutral">
                {room.requiredRequirementCount} eligibility requirement
                {room.requiredRequirementCount === 1 ? "" : "s"}
              </StatusChip>
            )
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {room.facilities.slice(0, 3).map((facility) => (
            <span
              key={facility}
              className="rounded-md border border-sand-200 bg-sand-50 px-2 py-1 text-[0.66rem] font-medium text-ink-700"
            >
              {facility}
            </span>
          ))}
          {room.facilities.length > 3 ? (
            <span className="rounded-md border border-transparent px-2 py-1 text-[0.66rem] font-medium text-ink-600">
              +{room.facilities.length - 3} more
            </span>
          ) : null}
        </div>

        <p className="mt-4 line-clamp-2 text-xs leading-5 text-ink-600">
          {room.policySummary}
        </p>

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-sand-200 pt-4">
          <p className="text-[0.66rem] leading-4 text-ink-600">
            {room.availability === "available"
              ? "Submit a request for manager review."
              : room.availability === "conflict"
                ? "Choose another time or room."
                : room.availability === "outside_hours"
                  ? "Check the room hours before requesting."
                  : room.availability === "invalid_time"
                    ? "Use the room's time increment and duration rules."
                    : "Open the room to see its rules."}
          </p>
          <Link
            href={detailHref}
            className="inline-flex shrink-0 items-center gap-1.5 text-xs font-bold text-brand-700 hover:text-brand-600"
          >
            View room
            <svg
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
              className="size-3.5 transition group-hover:translate-x-0.5"
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
    </article>
  );
}

export default async function RoomsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireCurrentProfile();
  const rawParams = await searchParams;
  const parsed = parseRoomSearchParams(rawParams);
  const db = getDatabase();
  const filterOptions = getRoomFilterOptions(db);

  const rooms = parsed.ok
    ? searchRooms(
        db,
        profile,
        {
          minCapacity: parsed.values.minCapacity
            ? Number(parsed.values.minCapacity)
            : null,
          building: parsed.values.building || null,
          facilities: parsed.values.facilities,
        },
        parsed.interval,
      )
    : searchRooms(
        db,
        profile,
        { minCapacity: null, building: null, facilities: [] },
        null,
      );

  const values = parsed.values;
  const query = parsed.ok ? toRoomSearchQuery(values).toString() : "";
  const availableCount = rooms.filter(
    (room) => room.availability === "available",
  ).length;

  return (
    <div className="space-y-7">
      <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <p className="eyebrow">Room discovery · Phase 2</p>
            <StatusChip tone="green">Request workflow live</StatusChip>
          </div>
          <h1 className="mt-3 max-w-3xl font-display text-4xl leading-[1.03] tracking-[-0.04em] text-ink-950 sm:text-5xl">
            Find the right room,
            <span className="italic text-brand-700"> then make the ask.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-ink-700 sm:text-base sm:leading-7">
            Filter the campus catalog, check room rules, and submit a request
            for manager review. A request never grants access on its own.
          </p>
        </div>
        {profile.role === "student" ? (
          <Link href="/app/bookings" className="btn-secondary shrink-0">
            My requests
          </Link>
        ) : null}
      </section>

      <section className="surface p-4 sm:p-5" aria-labelledby="filters-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p id="filters-heading" className="text-sm font-bold text-ink-950">
              Search the catalog
            </p>
            <p className="mt-1 text-xs text-ink-600">
              Time filters check opening hours and confirmed bookings.
            </p>
          </div>
          {parsed.ok && parsed.hasFilters ? (
            <Link
              href="/app/rooms"
              className="text-xs font-semibold text-brand-700 hover:text-brand-600"
            >
              Clear filters
            </Link>
          ) : null}
        </div>

        {!parsed.ok ? (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-flag-amber/20 bg-flag-amber-bg px-4 py-3 text-sm leading-5 text-flag-amber"
          >
            {parsed.error}
          </div>
        ) : null}

        <form
          method="get"
          action="/app/rooms"
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-12"
        >
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
              defaultValue={values.date}
              className="field"
            />
          </div>
          <div className="lg:col-span-2">
            <label
              htmlFor="start"
              className="mb-1.5 block text-xs font-semibold text-ink-800"
            >
              Start
            </label>
            <input
              id="start"
              name="start"
              type="time"
              step="900"
              defaultValue={values.startTime}
              className="field"
            />
          </div>
          <div className="lg:col-span-2">
            <label
              htmlFor="end"
              className="mb-1.5 block text-xs font-semibold text-ink-800"
            >
              End
            </label>
            <input
              id="end"
              name="end"
              type="time"
              step="900"
              defaultValue={values.endTime}
              className="field"
            />
          </div>
          <div className="lg:col-span-2">
            <label
              htmlFor="capacity"
              className="mb-1.5 block text-xs font-semibold text-ink-800"
            >
              Minimum seats
            </label>
            <input
              id="capacity"
              name="capacity"
              type="number"
              min="1"
              inputMode="numeric"
              placeholder="Any"
              defaultValue={values.minCapacity}
              className="field"
            />
          </div>
          <div className="lg:col-span-4">
            <label
              htmlFor="building"
              className="mb-1.5 block text-xs font-semibold text-ink-800"
            >
              Building
            </label>
            <select
              id="building"
              name="building"
              defaultValue={values.building}
              className="field"
            >
              <option value="">Any building</option>
              {filterOptions.buildings.map((building) => (
                <option key={building} value={building}>
                  {building}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="sm:col-span-2 lg:col-span-10">
            <legend className="mb-2 text-xs font-semibold text-ink-800">
              Facilities
            </legend>
            <div className="flex flex-wrap gap-2">
              {filterOptions.facilities.map((facility) => (
                <label
                  key={facility}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-sand-200 bg-sand-50 px-3 py-2 text-xs font-medium text-ink-700 transition hover:border-brand-500/40 hover:bg-brand-50 has-[:checked]:border-brand-600/30 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700"
                >
                  <input
                    type="checkbox"
                    name="facility"
                    value={facility}
                    defaultChecked={values.facilities.includes(facility)}
                    className="size-3.5 accent-teal-700"
                  />
                  {facility}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex items-end lg:col-span-2">
            <button type="submit" className="btn-dark w-full">
              Search rooms
            </button>
          </div>
        </form>

        <p className="mt-3 text-[0.66rem] leading-4 text-ink-600">
          Times are shown in the campus timezone. Requests must meet each
          room&apos;s notice, duration, and opening-hour rules.
        </p>
      </section>

      <section aria-labelledby="results-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Campus catalog</p>
            <h2
              id="results-heading"
              className="mt-1.5 text-xl font-bold tracking-tight text-ink-950"
            >
              {rooms.length} {rooms.length === 1 ? "room" : "rooms"} found
            </h2>
          </div>
          {parsed.ok && parsed.interval ? (
            <p className="text-xs text-ink-600">
              {parsed.interval.dateLabel} · {parsed.interval.startLabel}–
              {parsed.interval.endLabel} · {availableCount} available
            </p>
          ) : (
            <p className="text-xs text-ink-600">
              Add a date and time to check a specific slot.
            </p>
          )}
        </div>

        {rooms.length > 0 ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rooms.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                query={query}
                role={profile.role}
              />
            ))}
          </div>
        ) : (
          <div className="surface mt-4 flex flex-col items-center justify-center px-6 py-14 text-center">
            <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-sand-100 text-ink-700">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                className="size-5"
              >
                <circle
                  cx="10.5"
                  cy="10.5"
                  r="5.75"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="m15 15 4.5 4.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <h3 className="mt-4 text-base font-bold text-ink-950">
              No rooms match these filters.
            </h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-ink-600">
              Try a broader time window, fewer facilities, or a lower minimum
              capacity.
            </p>
            <Link href="/app/rooms" className="btn-secondary mt-5">
              Clear all filters
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
