import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RoomDetailsForm } from "@/components/admin/room-details-form";
import { listAssignableManagers } from "@/lib/admin/rooms";
import { requireCurrentProfile } from "@/lib/auth/session";
import { getDatabase } from "@/lib/db/client";

export const metadata: Metadata = {
  title: "Add a room",
};

export default async function NewRoomPage() {
  const profile = await requireCurrentProfile();

  if (profile.role !== "admin" || profile.status !== "active") {
    notFound();
  }

  const managers = await listAssignableManagers(getDatabase());

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <nav className="text-sm text-ink-600" aria-label="Breadcrumb">
        <Link href="/app/admin/rooms" className="hover:text-ink-950">Rooms and rules</Link>
        <span aria-hidden="true"> / </span>
        <span className="font-semibold text-ink-800">Add a room</span>
      </nav>
      <header>
        <h1 className="font-display text-4xl tracking-[-0.03em] text-ink-950">Add a room</h1>
        <p className="mt-3 text-sm leading-6 text-ink-700">
          The room opens Monday to Friday, 09:00–17:00, with standard booking
          rules. You can change both on the next screen.
        </p>
      </header>
      <section className="surface p-5 sm:p-6">
        {managers.length === 0 ? (
          <p className="text-sm text-ink-700">
            There are no active room managers to assign. A room needs a manager
            to review its requests.
          </p>
        ) : (
          <RoomDetailsForm
            mode="create"
            initial={{
              code: "",
              name: "",
              building: "",
              location: "",
              capacity: "",
              facilities: "",
              policySummary: "",
              managerId: "",
              status: "active",
            }}
            managers={managers}
            canAssignManager
            canChangeStatus={false}
          />
        )}
      </section>
    </div>
  );
}
