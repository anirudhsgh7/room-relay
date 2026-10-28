"use client";

import { useActionState } from "react";
import {
  resolveIncidentAction,
  reviewIncidentAction,
  type IncidentActionState,
} from "@/app/app/incidents/actions";

function InlineError({ id, message }: { id: string; message?: string }) {
  if (!message) {
    return null;
  }

  return (
    <p id={id} className="mt-1.5 text-xs leading-4 text-flag-red">
      {message}
    </p>
  );
}

export function IncidentReviewForm({ incidentId }: { incidentId: string }) {
  const [state, formAction, pending] = useActionState<
    IncidentActionState,
    FormData
  >(reviewIncidentAction, {});

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="incidentId" value={incidentId} />
      {state.error ? (
        <div
          role="alert"
          className="rounded-xl border border-flag-red/20 bg-flag-red-bg px-4 py-3 text-sm leading-5 text-flag-red"
        >
          {state.error}
        </div>
      ) : null}
      <div>
        <label
          htmlFor="reviewNote"
          className="mb-1.5 block text-xs font-semibold text-ink-800"
        >
          Manager review / recommendation
        </label>
        <textarea
          id="reviewNote"
          name="note"
          rows={3}
          maxLength={1000}
          className="field h-auto min-h-24 resize-y py-3"
          placeholder="Record the facts and any recommendation. This is not a penalty decision."
          aria-invalid={Boolean(state.fieldErrors?.note)}
          aria-describedby={
            state.fieldErrors?.note ? "review-note-error" : "review-note-help"
          }
        />
        <p id="review-note-help" className="mt-1.5 text-xs text-ink-600">
          Required, 10–1,000 characters. The admin makes the final resolution.
        </p>
        <InlineError id="review-note-error" message={state.fieldErrors?.note} />
      </div>
      <button type="submit" disabled={pending} className="btn-secondary w-full">
        {pending ? "Saving review…" : "Start incident review"}
      </button>
    </form>
  );
}

export function IncidentResolveForm({ incidentId }: { incidentId: string }) {
  const [state, formAction, pending] = useActionState<
    IncidentActionState,
    FormData
  >(resolveIncidentAction, {});

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="incidentId" value={incidentId} />
      {state.error ? (
        <div
          role="alert"
          className="rounded-xl border border-flag-red/20 bg-flag-red-bg px-4 py-3 text-sm leading-5 text-flag-red"
        >
          {state.error}
        </div>
      ) : null}
      <div>
        <label
          htmlFor="resolutionNote"
          className="mb-1.5 block text-xs font-semibold text-ink-800"
        >
          Final admin resolution
        </label>
        <textarea
          id="resolutionNote"
          name="resolutionNote"
          rows={3}
          maxLength={1500}
          className="field h-auto min-h-24 resize-y py-3"
          placeholder="Document the final operational resolution. No automatic penalty is applied."
          aria-invalid={Boolean(state.fieldErrors?.note)}
          aria-describedby={
            state.fieldErrors?.note
              ? "resolution-note-error"
              : "resolution-note-help"
          }
        />
        <p id="resolution-note-help" className="mt-1.5 text-xs text-ink-600">
          Required, 10–1,500 characters. Completes the booking when all incidents
          for it are resolved.
        </p>
        <InlineError
          id="resolution-note-error"
          message={state.fieldErrors?.note}
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="btn w-full border border-flag-green/25 bg-flag-green-bg text-flag-green hover:bg-flag-green-bg/70"
      >
        {pending ? "Saving resolution…" : "Resolve incident"}
      </button>
    </form>
  );
}
