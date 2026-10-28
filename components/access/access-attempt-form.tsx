"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AccessCheckResponse } from "@/lib/access/types";
import type {
  AccessBookingOption,
  CredentialOption,
  RoomOption,
} from "@/lib/access/queries";

interface AccessAttemptFormProps {
  credentials: CredentialOption[];
  rooms: RoomOption[];
  accessWindows: AccessBookingOption[];
  initialNonce: string;
  timeZone: string;
  suggestedCredentialId: string;
  suggestedRoomId: string;
}

interface ApiError {
  error?: string;
  reasonCode?: string;
}

function newNonce(): string {
  return crypto.randomUUID();
}

export function AccessAttemptForm({
  credentials,
  rooms,
  accessWindows,
  initialNonce,
  timeZone,
  suggestedCredentialId,
  suggestedRoomId,
}: AccessAttemptFormProps) {
  const router = useRouter();
  const [credentialId, setCredentialId] = useState(suggestedCredentialId);
  const [roomId, setRoomId] = useState(suggestedRoomId);
  const [nonce, setNonce] = useState(initialNonce);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AccessCheckResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const selectedCredential = credentials.find(
    (credential) => credential.id === credentialId,
  );
  const selectedWindow = accessWindows.find(
    (window) => window.roomId === roomId,
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!credentialId || !roomId || pending) {
      return;
    }

    setPending(true);
    setResult(null);
    setError(null);

    try {
      const response = await fetch("/api/access/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentialId,
          roomId,
          eventNonce: nonce,
        }),
      });
      const payload = (await response.json()) as
        | AccessCheckResponse
        | ApiError;

      if ("decision" in payload) {
        setResult(payload);
        setNonce(newNonce());
        router.refresh();
      } else {
        setError(payload);
        if (response.status === 409 || response.status === 400) {
          setNonce(newNonce());
        }
      }
    } catch {
      setError({
        error:
          "The access service could not be reached. No access was granted.",
        reasonCode: "SERVICE_UNAVAILABLE",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="space-y-4">
        <input type="hidden" name="eventNonce" value={nonce} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="credentialId"
              className="mb-1.5 block text-xs font-semibold text-ink-800"
            >
              Your credential
            </label>
            <select
              id="credentialId"
              name="credentialId"
              value={credentialId}
              onChange={(event) => setCredentialId(event.target.value)}
              className="field"
              disabled={pending || credentials.length === 0}
            >
              {credentials.map((credential) => (
                <option key={credential.id} value={credential.id}>
                  {credential.label} · {credential.active ? "Active" : "Revoked"}
                </option>
              ))}
            </select>
            {credentials.length === 0 ? (
              <p className="mt-1.5 text-xs text-flag-red">
                No credentials are mapped to this account.
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="roomId"
              className="mb-1.5 block text-xs font-semibold text-ink-800"
            >
              Room
            </label>
            <select
              id="roomId"
              name="roomId"
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
              className="field"
              disabled={pending || rooms.length === 0}
            >
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name} · {room.code}
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedCredential && !selectedCredential.active ? (
          <div className="rounded-xl border border-flag-amber/20 bg-flag-amber-bg px-4 py-3 text-xs leading-5 text-flag-amber">
            This credential is revoked. The attempt will be denied and logged.
          </div>
        ) : null}

        {selectedWindow ? (
          <div className="rounded-xl border border-sand-200 bg-sand-50 px-4 py-3 text-xs leading-5 text-ink-700">
            Your {selectedWindow.status.replaceAll("_", " ")} booking for this
            room:{" "}
            <strong>
              {selectedWindow.dateLabel} · {selectedWindow.timeLabel}
            </strong>
            . The server compares the current time to this window.
          </div>
        ) : (
          <div className="rounded-xl border border-sand-200 bg-sand-50 px-4 py-3 text-xs leading-5 text-ink-600">
            No approved or checked-in booking for this room is currently in your
            account. The attempt will be denied and logged.
          </div>
        )}

        <div className="rounded-xl border border-brand-600/15 bg-brand-50 px-4 py-3 text-xs leading-5 text-brand-700">
          This is a software simulation. It does not connect to, command, or
          unlock a physical door.
        </div>

        <button
          type="submit"
          disabled={
            pending ||
            credentials.length === 0 ||
            rooms.length === 0 ||
            !credentialId ||
            !roomId
          }
          className="btn-primary w-full"
        >
          {pending ? (
            <>
              <span
                className="size-4 animate-spin rounded-full border-2 border-ink-950/25 border-t-ink-950"
                aria-hidden="true"
              />
              Checking access…
            </>
          ) : (
            <>
              Simulate access check
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
      </form>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-flag-red/20 bg-flag-red-bg px-4 py-3 text-sm leading-5 text-flag-red"
        >
          <p className="font-semibold">Access check unavailable</p>
          <p className="mt-1">{error.error}</p>
          {error.reasonCode ? (
            <p className="mt-2 font-mono text-[0.62rem] uppercase tracking-wide">
              {error.reasonCode}
            </p>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-2xl border p-5 ${
            result.decision === "ALLOW"
              ? "border-flag-green/20 bg-flag-green-bg text-flag-green"
              : "border-flag-red/20 bg-flag-red-bg text-flag-red"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.14em]">
              Simulated access check
            </p>
            {result.replayed ? (
              <span className="rounded-full border border-current/20 px-2 py-1 text-[0.6rem] font-bold uppercase tracking-wider">
                Replayed receipt
              </span>
            ) : null}
          </div>
          <p className="mt-2 font-display text-3xl tracking-[-0.03em]">
            {result.decision === "ALLOW" ? "Allowed" : "Denied"}
          </p>
          <p className="mt-2 text-sm leading-6">{result.message}</p>
          <div className="mt-4 grid gap-2 border-t border-current/15 pt-4 text-xs sm:grid-cols-2">
            <div>
              <p className="opacity-60">Reason code</p>
              <p className="mt-0.5 font-mono font-semibold">{result.reasonCode}</p>
            </div>
            <div>
              <p className="opacity-60">Server time</p>
              <p className="mt-0.5 font-semibold">
                {new Intl.DateTimeFormat("en-GB", {
                  timeZone,
                  dateStyle: "medium",
                  timeStyle: "medium",
                }).format(new Date(result.occurredAt))}
              </p>
            </div>
            {result.eventId ? (
              <div className="sm:col-span-2">
                <p className="opacity-60">Access event</p>
                <p className="mt-0.5 break-all font-mono text-[0.68rem]">
                  {result.eventId}
                </p>
              </div>
            ) : null}
            {result.bookingStatus ? (
              <div>
                <p className="opacity-60">Booking status</p>
                <p className="mt-0.5 font-semibold capitalize">
                  {result.bookingStatus.replaceAll("_", " ")}
                </p>
              </div>
            ) : null}
          </div>
          <p className="mt-4 text-[0.65rem] leading-4 opacity-75">
            This was a software policy decision. No physical door was unlocked.
          </p>
        </div>
      ) : null}
    </div>
  );
}
