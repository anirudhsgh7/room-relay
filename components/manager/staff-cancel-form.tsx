"use client";

import { useActionState, useState } from "react";
import {
  cancelAsStaffAction,
  type StaffCancelFormState,
} from "@/app/app/manager/actions";

export function StaffCancelForm({
  bookingId,
  status,
  requesterName,
}: {
  bookingId: string;
  status: "pending" | "approved" | "waitlisted";
  requesterName: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<StaffCancelFormState, FormData>(
    cancelAsStaffAction,
    {},
  );
  const label =
    status === "waitlisted"
      ? "Remove from waitlist"
      : status === "approved"
        ? "Cancel this booking"
        : "Withdraw this request";

  if (!open) {
    return (
      <div className="surface p-5">
        <h2 className="text-base font-bold text-ink-950">{label}</h2>
        <p className="mt-1 text-sm leading-6 text-ink-600">
          {status === "approved"
            ? `Use this only when the room genuinely cannot be used, for example an emergency. ${requesterName} is told your reason, and the time is offered to the waitlist.`
            : `${requesterName} is told your reason.`}
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 inline-flex min-h-10 items-center rounded-full border border-flag-red/25 px-4 text-sm font-semibold text-flag-red hover:bg-flag-red-bg"
        >
          {label}
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="surface border-flag-red/25 p-5" noValidate>
      <input type="hidden" name="bookingId" value={bookingId} />
      <h2 className="text-base font-bold text-ink-950">{label}</h2>
      {state.error ? (
        <p role="alert" className="mt-3 rounded-lg border border-flag-red/20 bg-flag-red-bg px-3 py-2 text-sm text-flag-red">
          {state.error}
        </p>
      ) : null}
      <label htmlFor="staff-cancel-reason" className="field-label mt-3">
        Reason {requesterName} will see
      </label>
      <textarea
        id="staff-cancel-reason"
        name="reason"
        rows={3}
        maxLength={500}
        className="field h-auto min-h-24 resize-y py-3"
        placeholder="e.g. Burst pipe in the ceiling; the room is closed until repaired."
      />
      <p className="field-help">At least 10 characters.</p>
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={() => setOpen(false)} className="btn-secondary">
          Keep it
        </button>
        <button
          type="submit"
          disabled={pending}
          className="btn border border-flag-red/30 bg-white text-flag-red hover:bg-flag-red-bg"
        >
          {pending ? "Saving…" : label}
        </button>
      </div>
    </form>
  );
}
