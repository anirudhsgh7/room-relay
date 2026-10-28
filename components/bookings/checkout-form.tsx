"use client";

import { useActionState, useState } from "react";
import {
  checkOutBookingAction,
  type CheckoutFormState,
} from "@/app/app/bookings/actions";
import {
  INCIDENT_CATEGORIES,
  INCIDENT_CATEGORY_LABELS,
} from "@/lib/incidents/constants";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) {
    return null;
  }

  return (
    <p id={id} className="mt-1.5 text-xs leading-4 text-flag-red">
      {message}
    </p>
  );
}

export function CheckoutForm({ bookingId }: { bookingId: string }) {
  const [conditionState, setConditionState] = useState<
    "left_as_found" | "issue_found"
  >("left_as_found");
  const [state, formAction, pending] = useActionState<
    CheckoutFormState,
    FormData
  >(checkOutBookingAction, {});
  const issueFound = conditionState === "issue_found";

  return (
    <section className="surface overflow-hidden" aria-labelledby="checkout-heading">
      <div className="border-b border-sand-200 px-5 py-4">
        <p id="checkout-heading" className="text-sm font-bold text-ink-950">
          Check out
        </p>
        <p className="mt-1 text-xs leading-5 text-ink-600">
          Record the room condition and close this checked-in booking. This does
          not involve a physical lock.
        </p>
      </div>

      <form action={formAction} className="space-y-4 p-5" noValidate>
        <input type="hidden" name="bookingId" value={bookingId} />
        <input type="hidden" name="conditionState" value={conditionState} />

        {state.error ? (
          <div
            role="alert"
            className="rounded-xl border border-flag-red/20 bg-flag-red-bg px-4 py-3 text-sm leading-5 text-flag-red"
          >
            {state.error}
          </div>
        ) : null}

        <fieldset>
          <legend className="text-xs font-semibold text-ink-800">
            How was the room left?
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label
              className={`cursor-pointer rounded-xl border p-3 text-xs leading-5 transition ${
                !issueFound
                  ? "border-brand-600/35 bg-brand-50 text-brand-700"
                  : "border-sand-200 bg-sand-50 text-ink-700"
              }`}
            >
              <input
                type="radio"
                name="conditionChoice"
                value="left_as_found"
                checked={!issueFound}
                onChange={() => setConditionState("left_as_found")}
                className="mr-2 size-3.5 accent-teal-700"
              />
              <span className="font-semibold">Left as found</span>
              <span className="mt-1 block text-[0.65rem] text-ink-600">
                Close the booking as completed.
              </span>
            </label>
            <label
              className={`cursor-pointer rounded-xl border p-3 text-xs leading-5 transition ${
                issueFound
                  ? "border-flag-red/25 bg-flag-red-bg text-flag-red"
                  : "border-sand-200 bg-sand-50 text-ink-700"
              }`}
            >
              <input
                type="radio"
                name="conditionChoice"
                value="issue_found"
                checked={issueFound}
                onChange={() => setConditionState("issue_found")}
                className="mr-2 size-3.5 accent-teal-700"
              />
              <span className="font-semibold">Issue needs review</span>
              <span className="mt-1 block text-[0.65rem] text-ink-600">
                Open an incident for human review.
              </span>
            </label>
          </div>
        </fieldset>

        <div>
          <label
            htmlFor="notes"
            className="mb-1.5 block text-xs font-semibold text-ink-800"
          >
            Condition note
          </label>
          <textarea
            id="notes"
            name="notes"
            required
            minLength={5}
            maxLength={1000}
            rows={3}
            defaultValue={
              issueFound ? "" : "Room left as found. No issues reported."
            }
            className="field h-auto min-h-24 resize-y py-3"
            aria-invalid={Boolean(state.fieldErrors?.notes)}
            aria-describedby={
              state.fieldErrors?.notes ? "condition-notes-error" : undefined
            }
          />
          <FieldError id="condition-notes-error" message={state.fieldErrors?.notes} />
        </div>

        {issueFound ? (
          <div className="grid gap-4 border-t border-sand-200 pt-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="incidentCategory"
                className="mb-1.5 block text-xs font-semibold text-ink-800"
              >
                Issue category
              </label>
              <select
                id="incidentCategory"
                name="incidentCategory"
                className="field"
                aria-invalid={Boolean(state.fieldErrors?.incidentCategory)}
                aria-describedby={
                  state.fieldErrors?.incidentCategory
                    ? "incident-category-error"
                    : undefined
                }
              >
                <option value="">Choose a category</option>
                {INCIDENT_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {INCIDENT_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
              <FieldError
                id="incident-category-error"
                message={state.fieldErrors?.incidentCategory}
              />
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor="issueDescription"
                className="mb-1.5 block text-xs font-semibold text-ink-800"
              >
                Describe the issue
              </label>
              <textarea
                id="issueDescription"
                name="issueDescription"
                rows={3}
                maxLength={1500}
                className="field h-auto min-h-24 resize-y py-3"
                placeholder="What was found, and does it need follow-up?"
                aria-invalid={Boolean(state.fieldErrors?.issueDescription)}
                aria-describedby={
                  state.fieldErrors?.issueDescription
                    ? "issue-description-error"
                    : undefined
                }
              />
              <FieldError
                id="issue-description-error"
                message={state.fieldErrors?.issueDescription}
              />
            </div>
          </div>
        ) : null}

        <div className="rounded-xl border border-sand-200 bg-sand-50 px-3.5 py-3 text-xs leading-5 text-ink-600">
          This closes the operational booking record. It does not impose a fine,
          suspension, or other automatic penalty. An incident enters human review.
        </div>

        <button type="submit" disabled={pending} className="btn-primary w-full">
          {pending ? "Saving check-out…" : "Submit check-out"}
        </button>
      </form>
    </section>
  );
}
