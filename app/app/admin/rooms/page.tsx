import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusChip } from "@/components/badges";
import { canUseRoomAdmin, listAdminRooms } from "@/lib/admin/rooms";
import { requireCurrentProfile } from "@/lib/auth/session";
import { getDatabase } from "@/lib/db/client";

export const metadata: Metadata = {
  title: "Rooms and rules",
  description: "Room details, managers, hours, closures, and booking rules.",
};

export default async function AdminRoomsPage() {
  const profile = await requireCurrentProfile();

  if (!canUseRoomAdmin(profile)) {
    notFound();
  }

  const rooms = listAdminRooms(getDatabase(), profile);
  const isAdmin = profile.role === "admin";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-[-0.03em] text-ink-950 sm:text-5xl">
            {isAdmin ? "Rooms and rules" : "My rooms"}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-700 sm:text-base sm:leading-7">
            {isAdmin
              ? "Add rooms, assign managers, and set opening hours, closures, and booking rules."
              : "Set opening hours, plan closures, and choose the booking rules for the rooms you manage."}
          </p>
        </div>
        {isAdmin ? (
          <Link href="/app/admin/rooms/new" className="btn-primary">
            Add a room
          </Link>
        ) : null}
      </header>

      {rooms.length === 0 ? (
        <section className="surface p-8 text-center text-sm text-ink-700">
          {isAdmin ? "No rooms yet. Add the first one." : "No rooms are assigned to you yet."}
        </section>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rooms.map((room) => (
            <li key={room.id}>
              <Link
                href={`/app/admin/rooms/${room.id}`}
                className="surface flex h-full flex-col p-5 transition hover:border-ink-950/25"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-bold text-ink-950">{room.name}</p>
                    <p className="mt-0.5 text-sm text-ink-600">
                      {room.code} · {room.building} · {room.capacity} seats
                    </p>
                  </div>
                  {room.status === "inactive" ? (
                    <StatusChip tone="neutral">Closed</StatusChip>
                  ) : room.openDays === 0 ? (
                    <StatusChip tone="amber">No hours set</StatusChip>
                  ) : !room.requestsEnabled ? (
                    <StatusChip tone="neutral">Paused</StatusChip>
                  ) : (
                    <StatusChip tone="green">Open</StatusChip>
                  )}
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                  {[
                    ["To review", room.pendingCount],
                    ["Waitlisted", room.waitlistCount],
                    ["Booked", room.upcomingCount],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-sand-50 px-2 py-2">
                      <dd className="text-lg font-bold tabular-nums text-ink-950">{value}</dd>
                      <dt className="text-xs text-ink-600">{label}</dt>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-sm text-ink-600">
                  {isAdmin ? `Managed by ${room.managerName}. ` : ""}
                  {room.nextBlackout
                    ? `Next closure: ${room.nextBlackout.label}.`
                    : "No closures planned."}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
