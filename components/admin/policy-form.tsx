"use client";

import { useActionState } from "react";
import {
  updatePolicyAction,
  type AdminFormState,
} from "@/app/app/admin/rooms/actions";
import { FieldError, FormFeedback } from "@/components/admin/form-feedback";
import {
  BUFFER_OPTIONS,
  DURATION_OPTIONS,
  NOTICE_OPTIONS,
  SLOT_OPTIONS,
} from "@/lib/admin/options";
import { ALLOCATION_RULE_COPY, ALLOCATION_RULES, formatMinutes } from "@/lib/rooms/policy";
import type { RoomPolicy } from "@/lib/rooms/types";

function Select({
  name,
  label,
  help,
  options,
  value,
  format,
  error,
}: {
  name: string;
  label: string;
  help: string;
  options: readonly number[];
  value: string;
  format: (value: number) => string;
  error?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="field-label">{label}</label>
      <select id={name} name={name} defaultValue={value} className="field" aria-describedby={`${name}-help`}>
        {options.map((option) => (
          <option key={option} value={option}>{format(option)}</option>
        ))}
      </select>
      <p id={`${name}-help`} className="field-help">{help}</p>
      <FieldError message={error} />
    </div>
  );
}

const noticeLabel = (minutes: number) =>
  minutes === 0
    ? "No notice needed"
    : minutes === 1440
      ? "1 day"
      : minutes === 2880
        ? "2 days"
        : minutes === 10080
          ? "1 week"
          : formatMinutes(minutes);

export function PolicyForm({ roomId, policy }: { roomId: string; policy: RoomPolicy }) {
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(
    updatePolicyAction,
    {},
  );
  const errors = state.fieldErrors ?? {};
  const value = (field: keyof RoomPolicy) => {
    const saved = state.values?.[field];
    if (saved !== undefined) {
      return saved;
    }
    const current = policy[field];
    return typeof current === "boolean" ? (current ? "on" : "") : String(current);
  };

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <input type="hidden" name="roomId" value={roomId} />

      <div className="space-y-3">
        {[
          {
            name: "requestsEnabled" as const,
            title: "Taking requests",
            detail: "Turn off to pause new requests. Pending ones can still be declined.",
          },
          {
            name: "waitlistEnabled" as const,
            title: "Offer a waitlist",
            detail: "When a time is booked, people can wait for it. Existing waitlist places are kept if you turn this off.",
          },
        ].map((toggle) => (
          <label key={toggle.name} className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-sand-200 bg-white p-4">
            <span>
              <span className="block text-sm font-semibold text-ink-950">{toggle.title}</span>
              <span className="mt-0.5 block text-sm leading-6 text-ink-600">{toggle.detail}</span>
            </span>
            <input type="checkbox" name={toggle.name} defaultChecked={value(toggle.name) === "on"} className="toggle mt-1" />
          </label>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Select name="minimumNoticeMinutes" label="Minimum notice" help="How soon before the start a request can be sent." options={NOTICE_OPTIONS} value={value("minimumNoticeMinutes")} format={noticeLabel} error={errors.minimumNoticeMinutes} />
        <div>
          <label htmlFor="maxAdvanceDays" className="field-label">Book up to (days ahead)</label>
          <input id="maxAdvanceDays" name="maxAdvanceDays" type="number" min={1} max={365} inputMode="numeric" defaultValue={value("maxAdvanceDays")} className="field" aria-describedby="advance-help" aria-invalid={Boolean(errors.maxAdvanceDays)} />
          <p id="advance-help" className="field-help">Stops people holding dates far in the future.</p>
          <FieldError message={errors.maxAdvanceDays} />
        </div>
        <Select name="maximumDurationMinutes" label="Longest booking" help="Longer requests are refused." options={DURATION_OPTIONS} value={value("maximumDurationMinutes")} format={formatMinutes} error={errors.maximumDurationMinutes} />
        <Select name="slotIntervalMinutes" label="Start and end times" help="Bookings start and end on these marks." options={SLOT_OPTIONS} value={value("slotIntervalMinutes")} format={(minutes) => `Every ${minutes} minutes`} error={errors.slotIntervalMinutes} />
        <Select name="bufferMinutes" label="Gap between bookings" help="Time kept free after each booking for cleaning or changeover." options={BUFFER_OPTIONS} value={value("bufferMinutes")} format={(minutes) => (minutes === 0 ? "No gap" : formatMinutes(minutes))} error={errors.bufferMinutes} />
        <div>
          <label htmlFor="maxActivePerRequester" className="field-label">Upcoming requests per person</label>
          <input id="maxActivePerRequester" name="maxActivePerRequester" type="number" min={0} max={50} inputMode="numeric" defaultValue={value("maxActivePerRequester")} className="field" aria-describedby="quota-help" aria-invalid={Boolean(errors.maxActivePerRequester)} />
          <p id="quota-help" className="field-help">0 means no limit. Counts requests, waitlist places, and bookings not yet finished.</p>
          <FieldError message={errors.maxActivePerRequester} />
        </div>
      </div>

      <fieldset>
        <legend className="field-label">When several people want the same time</legend>
        <p className="field-help mt-0 mb-3">
          This rule is shown to everyone on the room page. Reviewers can approve
          out of order only by recording a reason.
        </p>
        <div className="grid gap-2 lg:grid-cols-3">
          {ALLOCATION_RULES.map((rule) => {
            const copy = ALLOCATION_RULE_COPY[rule];
            return (
              <label key={rule} className="flex cursor-pointer flex-col gap-2 rounded-xl border border-sand-200 bg-white p-4 has-[:checked]:border-brand-600/50 has-[:checked]:bg-brand-50 has-[:checked]:shadow-[inset_0_0_0_1px_var(--color-brand-600)]">
                <span className="flex items-center gap-2.5">
                  <input type="radio" name="allocationRule" value={rule} defaultChecked={value("allocationRule") === rule} className="accent-teal-700" />
                  <span className="text-sm font-bold text-ink-950">{copy.label}</span>
                </span>
                <ol className="list-decimal space-y-1 pl-5 text-xs leading-5 text-ink-700">
                  {copy.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </label>
            );
          })}
        </div>
        <FieldError message={errors.allocationRule} />
      </fieldset>

      <FormFeedback state={state} pending={pending} />

      <div className="flex justify-end">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Saving…" : "Save booking rules"}
        </button>
      </div>
    </form>
  );
}
