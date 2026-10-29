import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { removeBlackoutAction } from "@/app/app/admin/rooms/actions";
import { StatusChip } from "@/components/badges";
import { BlackoutForm } from "@/components/admin/blackout-form";
import { HoursForm } from "@/components/admin/hours-form";
import { PolicyForm } from "@/components/admin/policy-form";
import { RoomDetailsForm } from "@/components/admin/room-details-form";
import { getAdminRoom, listAssignableManagers } from "@/lib/admin/rooms";
import { requireCurrentProfile } from "@/lib/auth/session";
import { getDatabase } from "@/lib/db/client";
import { campusToday } from "@/lib/time/campus-time";

export const metadata: Metadata = {
  title: "Room settings",
};

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="surface scroll-mt-24 p-5 sm:p-6">
      <h2 id={`${id}-heading`} className="text-xl font-bold tracking-tight text-ink-950">
        {title}
      </h2>
      <p className="mt-1 mb-5 max-w-2xl text-sm leading-6 text-ink-600">{description}</p>
      {children}
    </section>
  );
}

export default async function RoomSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; reopened?: string }>;
}) {
  const profile = await requireCurrentProfile();
  const { id } = await params;
  const query = await searchParams;
  const db = getDatabase();
  const access = await getAdminRoom(db, profile, id);

  if (!access) {
    notFound();
  }

  const { room, permissions } = access;
  const managers = await listAssignableManagers(db);
  const sections = [
    { id: "details", label: "Details" },
    { id: "hours", label: "Opening hours" },
    { id: "closures", label: "Closures" },
    { id: "rules", label: "Booking rules" },
  ];

  return (
    <div className="space-y-6">
      <nav className="text-sm text-ink-600" aria-label="Breadcrumb">
        <Link href="/app/admin/rooms" className="hover:text-ink-950">
          {profile.role === "admin" ? "Rooms and rules" : "My rooms"}
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="font-semibold text-ink-800">{room.name}</span>
      </nav>

      {query.created === "1" ? (
        <p role="status" className="rounded-2xl border border-flag-green/20 bg-flag-green-bg p-4 text-sm leading-6 text-flag-green">
          <strong>{room.name} was added.</strong> Check its opening hours and
          booking rules below. People can request it straight away.
        </p>
      ) : null}
      {query.reopened === "1" ? (
        <p role="status" className="rounded-2xl border border-flag-green/20 bg-flag-green-bg p-4 text-sm leading-6 text-flag-green">
          Closure removed. That time can be requested again.
        </p>
      ) : null}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {room.status === "inactive" ? (
              <StatusChip tone="neutral">Closed</StatusChip>
            ) : room.policy.requestsEnabled ? (
              <StatusChip tone="green">Taking requests</StatusChip>
            ) : (
              <StatusChip tone="neutral">Requests paused</StatusChip>
            )}
            <span className="text-sm text-ink-600">{room.code}</span>
          </div>
          <h1 className="mt-2 font-display text-4xl tracking-[-0.03em] text-ink-950 sm:text-5xl">
            {room.name}
          </h1>
          <p className="mt-2 text-sm text-ink-700">
            {room.pendingCount} to review · {room.waitlistCount} waitlisted ·{" "}
            {room.upcomingCount} booked ahead · Managed by {room.managerName}
          </p>
        </div>
        {room.status === "active" ? (
          <Link href={`/app/rooms/${encodeURIComponent(room.code)}`} className="btn-secondary">
            See it as people booking do
          </Link>
        ) : null}
      </header>

      <nav aria-label="Room settings sections" className="sticky top-0 z-20 -mx-1 flex gap-1 overflow-x-auto bg-sand-50/95 px-1 py-2 backdrop-blur lg:top-0">
        {sections.map((section) => (
          <a key={section.id} href={`#${section.id}`} className="whitespace-nowrap rounded-full border border-sand-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-ink-800 hover:border-ink-950/20">
            {section.label}
          </a>
        ))}
      </nav>

      <Section
        id="details"
        title="Details"
        description={
          permissions.canEditDetails
            ? "What people see when they look for a room, and who reviews its requests."
            : "Only an administrator can change these. Ask one if something is wrong."
        }
      >
        {permissions.canEditDetails ? (
          <RoomDetailsForm
            mode="edit"
            roomId={room.id}
            initial={{
              code: room.code,
              name: room.name,
              building: room.building,
              location: room.location,
              capacity: room.capacity,
              facilities: room.facilities.join(", "),
              policySummary: room.policySummary,
              managerId: room.managerId,
              status: room.status,
            }}
            managers={managers}
            canAssignManager={permissions.canAssignManager}
            canChangeStatus={permissions.canChangeStatus}
          />
        ) : (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {[
              ["Building", `${room.building}, ${room.location}`],
              ["Seats", String(room.capacity)],
              ["Facilities", room.facilities.join(", ") || "None listed"],
              ["Note for people booking", room.policySummary || "None"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-sand-50 p-3">
                <dt className="text-ink-600">{label}</dt>
                <dd className="mt-0.5 font-semibold text-ink-950">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      <Section
        id="hours"
        title="Opening hours"
        description="Requests must fit inside these hours. Changes apply to new requests and decisions straight away; approved bookings are never cancelled by an hours change."
      >
        <HoursForm roomId={room.id} hours={room.hours} />
      </Section>

      <Section
        id="closures"
        title="Closures"
        description="Close the room for maintenance, exams, or events. Nobody can request it during a closure, and anyone already booked is told why."
      >
        {room.blackouts.length > 0 ? (
          <ul className="mb-5 divide-y divide-sand-200 rounded-xl border border-sand-200 bg-white">
            {room.blackouts.map((blackout) => (
              <li key={blackout.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-semibold text-ink-950">{blackout.label}</p>
                  <p className="mt-0.5 text-sm text-ink-600">
                    {blackout.reason} · added by {blackout.createdByName}
                  </p>
                </div>
                <form action={removeBlackoutAction}>
                  <input type="hidden" name="roomId" value={room.id} />
                  <input type="hidden" name="blackoutId" value={blackout.id} />
                  <button type="submit" className="text-sm font-semibold text-brand-700 hover:text-brand-600">
                    Reopen
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-5 text-sm text-ink-700">No closures planned.</p>
        )}
        <BlackoutForm roomId={room.id} today={campusToday()} />
      </Section>

      <Section
        id="rules"
        title="Booking rules"
        description="Published on the room page so people know what to expect before they ask."
      >
        <PolicyForm roomId={room.id} policy={room.policy} />
      </Section>
    </div>
  );
}
