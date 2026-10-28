"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  submitBookingRequestAction,
  type BookingFormState,
} from "@/app/app/rooms/actions";
import type { SafeAlternative } from "@/lib/bookings/types";
import type { RoomRequirement } from "@/lib/rooms/types";

interface RequestFormProps {
  roomCode: string;
  roomName: string;
  capacity: number;
  idempotencyKey: string;
  timeZone: string;
  defaults: {
    startDate: string;
    startTime: string;
    endTime: string;
  };
  requirements: RoomRequirement[];
}

function FieldError({
  id,
  message,
}: {
  id: string;
  message?: string;
}) {
  if (!message) {
    return null;
  }

  return (
    <p id={id} className="mt-1.5 text-xs leading-4 text-flag-red">
      {message}
    </p>
  );
}

function Alternatives({
  roomCode,
  alternatives,
}: {
  roomCode: string;
  alternatives: SafeAlternative[];
}) {
  if (alternatives.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 rounded-xl border border-sand-200 bg-white p-3.5">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-ink-600">
        Nearby options
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {alternatives.map((alternative) => {
          const params = new URLSearchParams({
            date: alternative.date,
            start: alternative.startTime,
            end: alternative.endTime,
          });

          return (
            <Link
              key={`${alternative.date}-${alternative.startTime}`}
              href={`/app/rooms/${encodeURIComponent(
                roomCode,
              )}/request?${params.toString()}`}
              className="rounded-full border border-brand-600/20 bg-brand-50 px-3 py-1.5 text-[0.68rem] font-semibold text-brand-700 hover:bg-brand-100"
            >
              {alternative.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function BookingRequestForm({
  roomCode,
  roomName,
  capacity,
  idempotencyKey,
  timeZone,
  defaults,
  requirements,
}: RequestFormProps) {
  const [state, formAction, pending] = useActionState<BookingFormState, FormData>(
    submitBookingRequestAction,
    {},
  );

  const unverified = requirements.filter(
    (requirement) => requirement.required && requirement.verification !== "verified",
  );

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="roomCode" value={roomCode} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      {state.error ? (
        <div
          role="alert"
          className="rounded-xl border border-flag-red/20 bg-flag-red-bg px-4 py-3 text-sm leading-5 text-flag-red"
        >
          <p className="font-semibold">The request was not submitted.</p>
          <p className="mt-1">{state.error}</p>
          {state.alternatives ? (
            <Alternatives
              roomCode={roomCode}
              alternatives={state.alternatives}
            />
          ) : null}
          {state.duplicateId ? (
            <Link
              href={`/app/bookings/${state.duplicateId}`}
              className="mt-2 inline-flex font-semibold underline underline-offset-2"
            >
              View your existing request
            </Link>
          ) : null}
        </div>
      ) : null}

      {unverified.length > 0 ? (
        <div className="rounded-xl border border-flag-amber/20 bg-flag-amber-bg px-4 py-3 text-sm leading-5 text-flag-amber">
          <p className="font-semibold">Eligibility review will be required.</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs">
            {unverified.map((requirement) => (
              <li key={requirement.id}>{requirement.description}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            You may submit this request. It will remain pending while a manager
            reviews eligibility.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <h2 className="text-sm font-bold text-ink-950">Requested time</h2>
          <p className="mt-1 text-xs text-ink-600">
            Times are campus-local ({timeZone}) and must be on the room&apos;s
            booking boundaries.
          </p>
        </div>

        <div>
          <label
            htmlFor="startDate"
            className="mb-1.5 block text-xs font-semibold text-ink-800"
          >
            Date
          </label>
          <input
            id="startDate"
            name="startDate"
            type="date"
            required
            defaultValue={defaults.startDate}
            className="field"
            aria-invalid={Boolean(state.fieldErrors?.startDate)}
            aria-describedby={
              state.fieldErrors?.startDate ? "start-date-error" : undefined
            }
          />
          <FieldError
            id="start-date-error"
            message={state.fieldErrors?.startDate}
          />
        </div>

        <div>
          <label
            htmlFor="startTime"
            className="mb-1.5 block text-xs font-semibold text-ink-800"
          >
            Start time
          </label>
          <input
            id="startTime"
            name="startTime"
            type="time"
            step="900"
            required
            defaultValue={defaults.startTime}
            className="field"
            aria-invalid={Boolean(state.fieldErrors?.startTime)}
            aria-describedby={
              state.fieldErrors?.startTime ? "start-time-error" : undefined
            }
          />
          <FieldError
            id="start-time-error"
            message={state.fieldErrors?.startTime}
          />
        </div>

        <div>
          <label
            htmlFor="endTime"
            className="mb-1.5 block text-xs font-semibold text-ink-800"
          >
            End time
          </label>
          <input
            id="endTime"
            name="endTime"
            type="time"
            step="900"
            required
            defaultValue={defaults.endTime}
            className="field"
            aria-invalid={Boolean(state.fieldErrors?.endTime)}
            aria-describedby={
              state.fieldErrors?.endTime ? "end-time-error" : undefined
            }
          />
          <FieldError
            id="end-time-error"
            message={state.fieldErrors?.endTime}
          />
        </div>
      </div>

      <div className="border-t border-sand-200 pt-5">
        <h2 className="text-sm font-bold text-ink-950">About the booking</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label
              htmlFor="purpose"
              className="mb-1.5 block text-xs font-semibold text-ink-800"
            >
              Purpose
            </label>
            <textarea
              id="purpose"
              name="purpose"
              required
              minLength={10}
              maxLength={500}
              rows={3}
              placeholder={`What will you use ${roomName} for?`}
              className="field h-auto min-h-24 resize-y py-3"
              aria-invalid={Boolean(state.fieldErrors?.purpose)}
              aria-describedby={
                state.fieldErrors?.purpose ? "purpose-error" : "purpose-help"
              }
            />
            <p id="purpose-help" className="mt-1.5 text-xs text-ink-600">
              Include enough context for the room manager to review the request.
            </p>
            <FieldError id="purpose-error" message={state.fieldErrors?.purpose} />
          </div>

          <div>
            <label
              htmlFor="groupName"
              className="mb-1.5 block text-xs font-semibold text-ink-800"
            >
              Group or club <span className="font-normal text-ink-600">(optional)</span>
            </label>
            <input
              id="groupName"
              name="groupName"
              type="text"
              maxLength={80}
              placeholder="e.g. Robotics Club"
              className="field"
              aria-invalid={Boolean(state.fieldErrors?.groupName)}
              aria-describedby={
                state.fieldErrors?.groupName ? "group-error" : undefined
              }
            />
            <FieldError id="group-error" message={state.fieldErrors?.groupName} />
          </div>

          <div>
            <label
              htmlFor="expectedAttendance"
              className="mb-1.5 block text-xs font-semibold text-ink-800"
            >
              Expected attendance
            </label>
            <input
              id="expectedAttendance"
              name="expectedAttendance"
              type="number"
              min="1"
              max={capacity}
              inputMode="numeric"
              required
              defaultValue={Math.min(2, capacity)}
              className="field"
              aria-invalid={Boolean(state.fieldErrors?.expectedAttendance)}
              aria-describedby={
                state.fieldErrors?.expectedAttendance
                  ? "attendance-error"
                  : "attendance-help"
              }
            />
            <p id="attendance-help" className="mt-1.5 text-xs text-ink-600">
              This room holds up to {capacity} people.
            </p>
            <FieldError
              id="attendance-error"
              message={state.fieldErrors?.expectedAttendance}
            />
          </div>
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-sand-200 bg-sand-50 p-4 has-[:checked]:border-brand-600/30 has-[:checked]:bg-brand-50">
        <input
          type="checkbox"
          name="acknowledgement"
          required
          className="mt-0.5 size-4 shrink-0 accent-teal-700"
          aria-invalid={Boolean(state.fieldErrors?.acknowledgement)}
          aria-describedby={
            state.fieldErrors?.acknowledgement ? "acknowledgement-error" : undefined
          }
        />
        <span className="text-xs leading-5 text-ink-700">
          I understand this is a pending request for manager review. It is{" "}
          <strong>not permission to enter</strong> the room.
          {state.fieldErrors?.acknowledgement ? (
            <span
              id="acknowledgement-error"
              className="mt-1 block text-flag-red"
            >
              {state.fieldErrors.acknowledgement}
            </span>
          ) : null}
        </span>
      </label>

      <div className="flex flex-col-reverse gap-2 border-t border-sand-200 pt-5 sm:flex-row sm:justify-end">
        <Link
          href={`/app/rooms/${encodeURIComponent(roomCode)}`}
          className="btn-secondary"
        >
          Cancel
        </Link>
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? (
            <>
              <span
                className="size-4 animate-spin rounded-full border-2 border-ink-950/25 border-t-ink-950"
                aria-hidden="true"
              />
              Submitting request…
            </>
          ) : (
            <>
              Submit request
              <svg
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
                className="size-4"
              >
                <path
                  d="M3.5 8h9M9 4.5 12.5 8 9 11.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </>
          )}
        </button>
      </div>
    </form>
  );
}
