import { BOOKING_STATUS_LABELS } from "@/lib/domain";
import type { ImpactedBooking } from "@/lib/admin/rooms";
import type { AdminFormState } from "@/app/app/admin/rooms/actions";

function ImpactList({ items }: { items: ImpactedBooking[] }) {
  return (
    <ul className="mt-2 divide-y divide-current/10 rounded-lg bg-white/70 text-sm text-ink-800">
      {items.map((item) => (
        <li key={item.id} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-3 py-2">
          <span className="font-semibold">{item.requesterName}</span>
          <span className="text-ink-600">
            {item.label} · {BOOKING_STATUS_LABELS[item.status]} · {item.expectedAttendance} people
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Success, error, warning, and confirm-before-cancelling states for admin forms. */
export function FormFeedback({
  state,
  confirmLabel,
  pending,
}: {
  state: AdminFormState;
  confirmLabel?: string;
  pending: boolean;
}) {
  return (
    <>
      {state.error ? (
        <p role="alert" className="rounded-xl border border-flag-red/20 bg-flag-red-bg px-4 py-3 text-sm leading-6 text-flag-red">
          {state.error}
        </p>
      ) : null}

      {state.message && !state.error && !state.confirm ? (
        <p role="status" className="rounded-xl border border-flag-green/20 bg-flag-green-bg px-4 py-3 text-sm leading-6 text-flag-green">
          {state.message}
        </p>
      ) : null}

      {state.warnings ? (
        <div className="rounded-xl border border-flag-amber/20 bg-flag-amber-bg p-4 text-flag-amber">
          <p className="text-sm leading-6 font-semibold">{state.warnings.title}</p>
          <ImpactList items={state.warnings.items} />
        </div>
      ) : null}

      {state.confirm ? (
        <div role="alert" className="rounded-xl border border-flag-red/25 bg-flag-red-bg p-4 text-flag-red">
          <p className="text-sm leading-6 font-semibold">{state.confirm.message}</p>
          {state.confirm.impact.length > 0 ? <ImpactList items={state.confirm.impact} /> : null}
          {state.confirm.inUse.length > 0 ? (
            <>
              <p className="mt-3 text-sm">In use now (will not be interrupted):</p>
              <ImpactList items={state.confirm.inUse} />
            </>
          ) : null}
          <label className="mt-3 flex items-start gap-2.5 text-sm text-ink-800">
            <input type="checkbox" name="confirmImpact" className="mt-1 size-4 accent-red-700" />
            <span>I understand. Go ahead and tell the people affected.</span>
          </label>
          {confirmLabel ? (
            <button
              type="submit"
              disabled={pending}
              className="btn mt-3 border border-flag-red/30 bg-white text-flag-red hover:bg-white/70"
            >
              {pending ? "Saving…" : confirmLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function FieldError({ message }: { message?: string }) {
  return message ? <p className="field-error">{message}</p> : null;
}
