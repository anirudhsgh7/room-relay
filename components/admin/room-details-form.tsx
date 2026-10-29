"use client";

import { useActionState } from "react";
import {
  createRoomAction,
  updateDetailsAction,
  type AdminFormState,
} from "@/app/app/admin/rooms/actions";
import { FieldError, FormFeedback } from "@/components/admin/form-feedback";
import type { ManagerOption } from "@/lib/admin/rooms";

interface RoomDetailsValues {
  code: string;
  name: string;
  building: string;
  location: string;
  capacity: number | string;
  facilities: string;
  policySummary: string;
  managerId: string;
  status: "active" | "inactive";
}

export function RoomDetailsForm({
  mode,
  roomId,
  initial,
  managers,
  canAssignManager,
  canChangeStatus,
}: {
  mode: "create" | "edit";
  roomId?: string;
  initial: RoomDetailsValues;
  managers: ManagerOption[];
  canAssignManager: boolean;
  canChangeStatus: boolean;
}) {
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(
    mode === "create" ? createRoomAction : updateDetailsAction,
    {},
  );
  const value = (field: keyof RoomDetailsValues) =>
    state.values?.[field] ?? String(initial[field] ?? "");
  const errors = state.fieldErrors ?? {};
  const formKey = state.savedAt ?? "initial";

  return (
    <form action={formAction} className="space-y-5" noValidate key={formKey}>
      {roomId ? <input type="hidden" name="roomId" value={roomId} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="field-label">Room name</label>
          <input id="name" name="name" className="field" defaultValue={value("name")} placeholder="e.g. Seminar Room 03" aria-invalid={Boolean(errors.name)} />
          <FieldError message={errors.name} />
        </div>
        <div>
          <label htmlFor="code" className="field-label">Room code</label>
          {mode === "create" ? (
            <>
              <input id="code" name="code" className="field uppercase" defaultValue={value("code")} placeholder="e.g. SEM-03" aria-invalid={Boolean(errors.code)} aria-describedby="code-help" />
              <p id="code-help" className="field-help">Short and unique. It appears in links and can&apos;t be changed later.</p>
            </>
          ) : (
            <>
              <input id="code" className="field bg-sand-100 text-ink-600" value={initial.code} readOnly aria-describedby="code-help" />
              <p id="code-help" className="field-help">Codes stay fixed so existing links keep working.</p>
            </>
          )}
          <FieldError message={errors.code} />
        </div>
        <div>
          <label htmlFor="building" className="field-label">Building</label>
          <input id="building" name="building" className="field" defaultValue={value("building")} aria-invalid={Boolean(errors.building)} />
          <FieldError message={errors.building} />
        </div>
        <div>
          <label htmlFor="location" className="field-label">Where in the building</label>
          <input id="location" name="location" className="field" defaultValue={value("location")} placeholder="e.g. Second floor, east wing" aria-invalid={Boolean(errors.location)} />
          <FieldError message={errors.location} />
        </div>
        <div>
          <label htmlFor="capacity" className="field-label">Seats</label>
          <input id="capacity" name="capacity" type="number" min={1} max={2000} inputMode="numeric" className="field" defaultValue={value("capacity")} aria-invalid={Boolean(errors.capacity)} />
          <FieldError message={errors.capacity} />
        </div>
        <div>
          <label htmlFor="managerId" className="field-label">Room manager</label>
          {canAssignManager ? (
            <select id="managerId" name="managerId" className="field" defaultValue={value("managerId")} aria-invalid={Boolean(errors.managerId)} aria-describedby="manager-help">
              <option value="">Choose a manager</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.displayName} ({manager.roomCount} {manager.roomCount === 1 ? "room" : "rooms"})
                </option>
              ))}
            </select>
          ) : (
            <>
              <input type="hidden" name="managerId" value={initial.managerId} />
              <input className="field bg-sand-100 text-ink-600" value={managers.find((manager) => manager.id === initial.managerId)?.displayName ?? "Assigned manager"} readOnly />
            </>
          )}
          <p id="manager-help" className="field-help">They review this room&apos;s requests. Reassigning moves pending requests to the new manager.</p>
          <FieldError message={errors.managerId} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="facilities" className="field-label">Facilities</label>
          <input id="facilities" name="facilities" className="field" defaultValue={value("facilities")} placeholder="Projector, Whiteboard, Step-free access" aria-describedby="facilities-help" aria-invalid={Boolean(errors.facilities)} />
          <p id="facilities-help" className="field-help">Separate with commas. People can filter rooms by these.</p>
          <FieldError message={errors.facilities} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="policySummary" className="field-label">Note for people booking</label>
          <textarea id="policySummary" name="policySummary" rows={2} maxLength={400} className="field h-auto min-h-20 resize-y py-3" defaultValue={value("policySummary")} placeholder="e.g. Return the furniture to boardroom layout. No food or drink." />
          <FieldError message={errors.policySummary} />
        </div>
      </div>

      {mode === "edit" ? (
        canChangeStatus ? (
          <fieldset>
            <legend className="field-label">Status</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { value: "active", title: "Open", detail: "Listed and bookable under its rules." },
                { value: "inactive", title: "Closed", detail: "Hidden from people booking. Upcoming bookings are cancelled after you confirm." },
              ].map((option) => (
                <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-xl border border-sand-200 bg-white p-3.5 has-[:checked]:border-brand-600/40 has-[:checked]:bg-brand-50">
                  <input type="radio" name="status" value={option.value} defaultChecked={value("status") === option.value} className="mt-1 accent-teal-700" />
                  <span>
                    <span className="block text-sm font-semibold text-ink-950">{option.title}</span>
                    <span className="block text-xs leading-5 text-ink-600">{option.detail}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <input type="hidden" name="status" value={initial.status} />
        )
      ) : null}

      <FormFeedback state={state} pending={pending} confirmLabel="Close room and cancel bookings" />

      {!state.confirm ? (
        <div className="flex justify-end">
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? "Saving…" : mode === "create" ? "Add room" : "Save details"}
          </button>
        </div>
      ) : null}
    </form>
  );
}
