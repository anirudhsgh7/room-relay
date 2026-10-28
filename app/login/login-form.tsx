"use client";

import { useActionState } from "react";
import { authenticateAction, type LoginState } from "@/app/login/actions";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    authenticateAction,
    {},
  );

  return (
    <form action={formAction} className="mt-7 space-y-4" noValidate>
      <input type="hidden" name="next" value={nextPath} />

      {state.error ? (
        <div
          role="alert"
          className="flex gap-3 rounded-xl border border-flag-red/20 bg-flag-red-bg px-4 py-3 text-sm leading-5 text-flag-red"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          >
            <circle
              cx="8"
              cy="8"
              r="6.25"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path
              d="M8 4.75v3.75M8 11.25h.01"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
          <span>{state.error}</span>
        </div>
      ) : null}

      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-ink-800">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state.email}
          placeholder="you@campus.example"
          className="field"
          aria-describedby="email-help"
        />
        <p id="email-help" className="mt-1.5 text-xs text-ink-600">
          Use one of the demo accounts listed on this page.
        </p>
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-semibold text-ink-800">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Enter your password"
          className="field"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="btn-dark mt-2 w-full"
        aria-describedby={pending ? "signing-in" : undefined}
      >
        {pending ? (
          <>
            <span
              className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
              aria-hidden="true"
            />
            <span id="signing-in">Verifying session…</span>
          </>
        ) : (
          <>
            Sign in securely
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
  );
}
