"use client";

import { useActionState, useState } from "react";
import {
  cancelBookingAction,
  type CancellationFormState,
} from "@/app/app/bookings/actions";
import type { BookingStatus } from "@/lib/domain";

export function CancelBookingForm({
  bookingId,
  status,
}: {
  bookingId: string;
  status: Extract<BookingStatus, "pending" | "approved" | "waitlisted">;
}) {
  const noun =
    status === "pending" ? "request" : status === "waitlisted" ? "waitlist place" : "booking";
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<
    CancellationFormState,
    FormData
  >(cancelBookingAction, {});

  if (!open) {
    return (
      <div className="rounded-xl border border-sand-200 bg-sand-50 p-4">
        <p className="text-sm font-bold text-ink-950">
          {status === "waitlisted"
            ? "No longer need this time?"
            : `Need to cancel this ${noun}?`}
        </p>
        <p className="mt-1 text-sm leading-6 text-ink-600">
          {status === "approved"
            ? "Cancelling frees the room for anyone on the waitlist."
            : status === "waitlisted"
              ? "Leaving the waitlist moves everyone behind you up."
              : "Cancelling withdraws the request from the manager's queue."}
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 inline-flex min-h-9 items-center rounded-full border border-flag-red/25 px-3.5 py-1.5 text-xs font-semibold text-flag-red transition hover:bg-flag-red-bg"
        >
          {status === "waitlisted"
            ? "Leave waitlist"
            : status === "pending"
              ? "Cancel request"
              : "Cancel booking"}
        </button>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="rounded-xl border border-flag-red/20 bg-flag-red-bg/55 p-4"
      noValidate
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <p className="text-sm font-bold text-ink-950">
        {status === "waitlisted" ? "Leave the waitlist" : `Cancel this ${noun}`}
      </p>
      <p className="mt-1 text-xs leading-5 text-ink-600">
        This action cannot be undone. You can submit a new request later if the
        room remains available.
      </p>

      {state.error ? (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-flag-red/20 bg-white px-3 py-2 text-xs leading-5 text-flag-red"
        >
          {state.error}
        </div>
      ) : null}

      <label
        htmlFor="cancellationReason"
        className="mt-3 block text-xs font-semibold text-ink-800"
      >
        Reason (kept in the booking history)
      </label>
      <textarea
        id="cancellationReason"
        name="cancellationReason"
        required
        minLength={5}
        maxLength={500}
        rows={2}
        className="field mt-1.5 h-auto min-h-20 resize-y py-3"
        placeholder="Why are you cancelling?"
        aria-invalid={Boolean(state.fieldErrors?.reason)}
        aria-describedby={
          state.fieldErrors?.reason ? "cancellation-reason-error" : undefined
        }
      />
      {state.fieldErrors?.reason ? (
        <p
          id="cancellation-reason-error"
          className="mt-1.5 text-xs text-flag-red"
        >
          {state.fieldErrors.reason}
        </p>
      ) : null}

      <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn-secondary min-h-9 px-3.5 py-1.5 text-xs"
        >
          Keep it
        </button>
        <button
          type="submit"
          disabled={pending}
          className="btn min-h-9 border border-flag-red/30 bg-white px-3.5 py-1.5 text-xs text-flag-red hover:bg-flag-red-bg"
        >
          {pending
            ? "Saving…"
            : status === "waitlisted"
              ? "Leave waitlist"
              : status === "pending"
                ? "Cancel request"
                : "Cancel booking"}
        </button>
      </div>
    </form>
  );
}
