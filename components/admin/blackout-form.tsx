"use client";

import { useActionState, useState } from "react";
import {
  addBlackoutAction,
  type AdminFormState,
} from "@/app/app/admin/rooms/actions";
import { FieldError, FormFeedback } from "@/components/admin/form-feedback";

export function BlackoutForm({ roomId, today }: { roomId: string; today: string }) {
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(
    addBlackoutAction,
    {},
  );
  const [allDay, setAllDay] = useState(state.values?.allDay !== "");
  const errors = state.fieldErrors ?? {};
  const values = state.values ?? {};
  // A fresh, empty form after each closure is added.
  const formKey = state.savedAt ?? "initial";

  return (
    <form key={formKey} action={formAction} className="space-y-4 rounded-xl border border-sand-200 bg-white p-4" noValidate>
      <input type="hidden" name="roomId" value={roomId} />
      <h3 className="text-base font-bold text-ink-950">Close the room for a period</h3>

      <label className="flex items-center gap-2.5 text-sm font-semibold text-ink-900">
        <input
          type="checkbox"
          name="allDay"
          checked={allDay}
          onChange={(event) => setAllDay(event.target.checked)}
          className="toggle"
        />
        Whole days
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="startDate" className="field-label">{allDay ? "First day" : "Starts"}</label>
          <div className="flex gap-2">
            <input id="startDate" name="startDate" type="date" min={today} defaultValue={values.startDate ?? today} className="field" aria-invalid={Boolean(errors.startDate)} />
            {!allDay ? (
              <>
                <label htmlFor="startTime" className="sr-only">Start time</label>
                <input id="startTime" name="startTime" type="time" step={900} defaultValue={values.startTime ?? "08:00"} className="field w-36 shrink-0" aria-invalid={Boolean(errors.startTime)} />
              </>
            ) : null}
          </div>
          <FieldError message={errors.startDate ?? errors.startTime} />
        </div>
        <div>
          <label htmlFor="endDate" className="field-label">{allDay ? "Last day" : "Ends"}</label>
          <div className="flex gap-2">
            <input id="endDate" name="endDate" type="date" min={today} defaultValue={values.endDate ?? today} className="field" aria-invalid={Boolean(errors.endDate)} />
            {!allDay ? (
              <>
                <label htmlFor="endTime" className="sr-only">End time</label>
                <input id="endTime" name="endTime" type="time" step={900} defaultValue={values.endTime ?? "18:00"} className="field w-36 shrink-0" aria-invalid={Boolean(errors.endTime)} />
              </>
            ) : null}
          </div>
          <FieldError message={errors.endDate ?? errors.endTime} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="reason" className="field-label">Reason people will see</label>
          <input id="reason" name="reason" maxLength={200} defaultValue={values.reason ?? ""} placeholder="e.g. Carpet replacement" className="field" aria-invalid={Boolean(errors.reason)} />
          <FieldError message={errors.reason} />
        </div>
      </div>

      <FormFeedback state={state} pending={pending} confirmLabel="Add closure and cancel bookings" />

      {!state.confirm ? (
        <div className="flex justify-end">
          <button type="submit" disabled={pending} className="btn-dark">
            {pending ? "Checking…" : "Add closure"}
          </button>
        </div>
      ) : null}
    </form>
  );
}
