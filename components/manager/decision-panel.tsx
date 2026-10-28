"use client";

import { useActionState, useState } from "react";
import {
  decideBookingAction,
  type DecisionFormState,
} from "@/app/app/manager/actions";
import type { SafeRequirement } from "@/lib/bookings/decisions";

interface DecisionPanelProps {
  bookingId: string;
  outstandingRequirements: SafeRequirement[];
}

function FieldError({ message, id }: { message?: string; id: string }) {
  if (!message) {
    return null;
  }

  return (
    <p id={id} className="mt-1.5 text-xs leading-4 text-flag-red">
      {message}
    </p>
  );
}

export function DecisionPanel({
  bookingId,
  outstandingRequirements,
}: DecisionPanelProps) {
  const [mode, setMode] = useState<"approve" | "reject">("approve");
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [state, formAction, pending] = useActionState<
    DecisionFormState,
    FormData
  >(decideBookingAction, {});

  const hasOutstanding = outstandingRequirements.length > 0;
  const showOverride =
    mode === "approve" && hasOutstanding && overrideEnabled;

  return (
    <section
      className="surface overflow-hidden"
      aria-labelledby="decision-heading"
    >
      <div className="border-b border-sand-200 px-5 py-4">
        <p id="decision-heading" className="text-sm font-bold text-ink-950">
          Manager decision
        </p>
        <p className="mt-1 text-xs leading-5 text-ink-600">
          Every decision rechecks current room policy, eligibility, and
          confirmed conflicts before saving.
        </p>
      </div>

      <div className="p-5">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-sand-100 p-1">
          <button
            type="button"
            onClick={() => setMode("approve")}
            aria-pressed={mode === "approve"}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
              mode === "approve"
                ? "bg-white text-ink-950 shadow-sm"
                : "text-ink-600 hover:text-ink-950"
            }`}
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => setMode("reject")}
            aria-pressed={mode === "reject"}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
              mode === "reject"
                ? "bg-white text-ink-950 shadow-sm"
                : "text-ink-600 hover:text-ink-950"
            }`}
          >
            Reject
          </button>
        </div>

        <form action={formAction} className="mt-4 space-y-4" noValidate>
          <input type="hidden" name="bookingId" value={bookingId} />
          <input type="hidden" name="decisionAction" value={mode} />

          {state.error ? (
            <div
              role="alert"
              className="rounded-xl border border-flag-red/20 bg-flag-red-bg px-4 py-3 text-sm leading-5 text-flag-red"
            >
              <p className="font-semibold">The decision was not saved.</p>
              <p className="mt-1">{state.error}</p>
              {state.requirements && state.requirements.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
                  {state.requirements.map((requirement) => (
                    <li key={requirement.id}>{requirement.description}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div>
            <label
              htmlFor="decisionReason"
              className="mb-1.5 block text-xs font-semibold text-ink-800"
            >
              {mode === "approve"
                ? "Why are you approving this request?"
                : "Why are you rejecting this request?"}
            </label>
            <textarea
              id="decisionReason"
              name="decisionReason"
              required
              minLength={10}
              maxLength={500}
              rows={3}
              className="field h-auto min-h-24 resize-y py-3"
              placeholder="This reason will be visible to the requester."
              aria-invalid={Boolean(state.fieldErrors?.decisionReason)}
              aria-describedby={
                state.fieldErrors?.decisionReason
                  ? "decision-reason-error"
                  : "decision-reason-help"
              }
            />
            <p
              id="decision-reason-help"
              className="mt-1.5 text-xs text-ink-600"
            >
              Required, 10–500 characters. Keep it specific and neutral.
            </p>
            <FieldError
              id="decision-reason-error"
              message={state.fieldErrors?.decisionReason}
            />
          </div>

          {mode === "reject" ? (
            <p className="rounded-xl border border-sand-200 bg-sand-50 p-3.5 text-xs leading-5 text-ink-600">
              Rejecting closes this request. The requester sees the reason and
              can submit a new request later.
            </p>
          ) : null}

          {mode === "approve" && hasOutstanding ? (
            <div className="rounded-xl border border-flag-amber/20 bg-flag-amber-bg p-4">
              <p className="text-sm font-bold text-flag-amber">
                Eligibility review is required.
              </p>
              <p className="mt-1 text-xs leading-5 text-flag-amber">
                Normal approval is blocked until these requirements are
                verified or explicitly overridden for this booking only.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
                {outstandingRequirements.map((requirement) => (
                  <li key={requirement.id}>{requirement.description}</li>
                ))}
              </ul>

              <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-flag-amber/20 bg-white/55 p-3 text-xs leading-5 text-flag-amber">
                <input
                  type="checkbox"
                  checked={overrideEnabled}
                  onChange={(event) => setOverrideEnabled(event.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-amber-700"
                />
                <span>
                  Override eligibility for this booking only. This does not
                  verify the student&apos;s profile for future requests.
                </span>
              </label>

              {showOverride ? (
                <div className="mt-3 space-y-3 border-t border-flag-amber/20 pt-3">
                  <fieldset>
                    <legend className="text-xs font-semibold text-ink-900">
                      Unmet requirements to override
                    </legend>
                    <div className="mt-2 space-y-2">
                      {outstandingRequirements.map((requirement) => (
                        <label
                          key={requirement.id}
                          className="flex items-start gap-2 text-xs text-ink-700"
                        >
                          <input
                            type="checkbox"
                            name="overrideRequirementIds"
                            value={requirement.id}
                            className="mt-0.5 size-3.5 accent-teal-700"
                          />
                          <span>{requirement.description}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div>
                    <label
                      htmlFor="overrideReason"
                      className="mb-1.5 block text-xs font-semibold text-ink-800"
                    >
                      Override reason
                    </label>
                    <textarea
                      id="overrideReason"
                      name="overrideReason"
                      rows={2}
                      maxLength={500}
                      className="field h-auto min-h-20 resize-y py-3"
                      placeholder="Explain the human review basis for this exception."
                      aria-invalid={Boolean(state.fieldErrors?.overrideReason)}
                      aria-describedby={
                        state.fieldErrors?.overrideReason
                          ? "override-reason-error"
                          : undefined
                      }
                    />
                    <FieldError
                      id="override-reason-error"
                      message={state.fieldErrors?.overrideReason}
                    />
                  </div>
                  <FieldError
                    id="override-requirements-error"
                    message={state.fieldErrors?.overrideRequirementIds}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className={
              mode === "approve"
                ? "btn-primary w-full"
                : "btn w-full border border-flag-red/25 bg-white text-flag-red hover:bg-flag-red-bg"
            }
          >
            {pending
              ? "Saving decision…"
              : mode === "approve"
                ? "Approve request"
                : "Reject request"}
          </button>
        </form>
      </div>
    </section>
  );
}