"use client";

import { useActionState, useState } from "react";
import {
  updateHoursAction,
  type AdminFormState,
} from "@/app/app/admin/rooms/actions";
import { FormFeedback } from "@/components/admin/form-feedback";
import type { WeekdayHours } from "@/lib/admin/rooms";

const NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function HoursForm({
  roomId,
  hours,
}: {
  roomId: string;
  hours: WeekdayHours[];
}) {
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(
    updateHoursAction,
    {},
  );
  const [days, setDays] = useState<WeekdayHours[]>(hours);

  function update(weekday: number, patch: Partial<WeekdayHours>) {
    setDays((current) =>
      current.map((day) => (day.weekday === weekday ? { ...day, ...patch } : day)),
    );
  }

  function copyMonday() {
    const monday = days.find((day) => day.weekday === 1);
    if (!monday) {
      return;
    }
    setDays((current) =>
      current.map((day) =>
        [2, 3, 4, 5].includes(day.weekday)
          ? { ...day, open: monday.open, opensAt: monday.opensAt, closesAt: monday.closesAt }
          : day,
      ),
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="roomId" value={roomId} />
      <ul className="divide-y divide-sand-200 rounded-xl border border-sand-200 bg-white">
        {days.map((day) => (
          <li key={day.weekday} className="grid grid-cols-[7.5rem_1fr] items-center gap-3 px-3.5 py-2.5 sm:grid-cols-[9rem_1fr]">
            <label className="flex items-center gap-2.5 text-sm font-semibold text-ink-950">
              <input
                type="checkbox"
                name={`open_${day.weekday}`}
                checked={day.open}
                onChange={(event) => update(day.weekday, { open: event.target.checked })}
                className="toggle"
              />
              {NAMES[day.weekday]}
            </label>
            {day.open ? (
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`opens_${day.weekday}`}>{NAMES[day.weekday]} opens at</label>
                <input id={`opens_${day.weekday}`} name={`opens_${day.weekday}`} type="time" step={900} value={day.opensAt} onChange={(event) => update(day.weekday, { opensAt: event.target.value })} className="field h-10 w-36 px-3" />
                <span className="text-sm text-ink-600">to</span>
                <label className="sr-only" htmlFor={`closes_${day.weekday}`}>{NAMES[day.weekday]} closes at</label>
                <input id={`closes_${day.weekday}`} name={`closes_${day.weekday}`} type="time" step={900} value={day.closesAt} onChange={(event) => update(day.weekday, { closesAt: event.target.value })} className="field h-10 w-36 px-3" />
              </div>
            ) : (
              <>
                <span className="text-sm text-ink-600">Closed</span>
                <input type="hidden" name={`opens_${day.weekday}`} value={day.opensAt} />
                <input type="hidden" name={`closes_${day.weekday}`} value={day.closesAt} />
              </>
            )}
          </li>
        ))}
      </ul>

      <FormFeedback state={state} pending={pending} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={copyMonday} className="text-sm font-semibold text-brand-700 hover:text-brand-600">
          Copy Monday to Tuesday–Friday
        </button>
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Saving…" : "Save hours"}
        </button>
      </div>
    </form>
  );
}
