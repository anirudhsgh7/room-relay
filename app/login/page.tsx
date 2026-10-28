import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark, Wordmark } from "@/components/brand";
import { RoleBadge } from "@/components/badges";
import { LoginForm } from "@/app/login/login-form";
import { quickSignInAction } from "@/app/login/actions";
import { safeNextPath } from "@/lib/auth/redirect";
import { redirectIfAuthenticated } from "@/lib/auth/session";
import { demoAccounts } from "@/lib/demo-accounts";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to the RoomRelay demo.",
};

const errorMessages: Record<string, string> = {
  "rate-limit": "Too many sign-in attempts. Wait a few minutes and try again.",
  unavailable: "Sign-in is temporarily unavailable. Please try again.",
  invalid: "Email or password is incorrect.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string | string[];
    next?: string | string[];
  }>;
}) {
  await redirectIfAuthenticated();

  const params = await searchParams;
  const errorCode = Array.isArray(params.error)
    ? params.error[0]
    : params.error;
  const quickError = errorCode ? errorMessages[errorCode] : undefined;
  const nextPath = safeNextPath(
    Array.isArray(params.next) ? params.next[0] : params.next,
  );

  return (
    <div className="min-h-screen bg-sand-50">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
        <Link href="/" aria-label="RoomRelay home">
          <Wordmark />
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-ink-700 transition hover:bg-sand-100 hover:text-ink-950"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="size-4"
          >
            <path
              d="M12.5 8h-9M7 4.5 3.5 8 7 11.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Home
        </Link>
      </header>

      <main className="mx-auto grid max-w-7xl gap-8 px-5 pb-14 pt-4 sm:px-8 lg:grid-cols-[0.92fr_1.08fr] lg:gap-12 lg:px-10 lg:pb-20 lg:pt-8">
        <section className="lg:pt-12">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <span className="chip border-ink-950/10 bg-white text-ink-700">
              <span className="size-1.5 rounded-full bg-brand-500" />
              Lifecycle demo
            </span>
            <span className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-ink-600">
              Phase 05 / Close-out
            </span>
          </div>

          <h1 className="font-display text-5xl leading-[0.98] tracking-[-0.045em] text-ink-950 sm:text-6xl">
            Pick up where
            <span className="block italic text-brand-700">trust begins.</span>
          </h1>

          <p className="mt-5 max-w-lg text-sm leading-6 text-ink-700 sm:text-base sm:leading-7">
            Sign in to run the complete booking lifecycle: discovery, manager
            decisions, simulated access, check-out, and human-reviewed
            incidents.
          </p>

          <div className="surface mt-8 max-w-lg p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-ink-950">Welcome back</p>
                <p className="mt-1 text-xs text-ink-600">
                  Demo credentials are listed alongside each account.
                </p>
              </div>
              <span className="inline-flex size-9 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                  className="size-4"
                >
                  <path
                    d="M7.5 9V6.75a2.5 2.5 0 0 1 5 0V9M5.75 9h8.5v6.25h-8.5V9Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </div>

            {quickError ? (
              <div
                role="alert"
                className="mt-5 flex gap-3 rounded-xl border border-flag-red/20 bg-flag-red-bg px-4 py-3 text-sm leading-5 text-flag-red"
              >
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-current" />
                {quickError}
              </div>
            ) : null}

            <LoginForm nextPath={nextPath} />
          </div>

          <p className="mt-5 max-w-lg text-xs leading-5 text-ink-600">
            Sessions are stored in a signed, HTTP-only cookie. Role and account
            status are re-read from the server database on every protected
            request.
          </p>
        </section>

        <section className="relative overflow-hidden rounded-[1.75rem] bg-ink-950 p-5 text-white sm:p-7 lg:p-8">
          <div className="grid-paper pointer-events-none absolute inset-0 opacity-60" />
          <div className="relative">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="label text-brand-300">Demo directory</p>
                <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">
                  Four roles. One trust model.
                </h2>
              </div>
              <BrandMark tone="dark" size="sm" />
            </div>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/55">
              These accounts are public test fixtures. They must never be reused
              for a real deployment.
            </p>

            <div className="mt-6 grid gap-3">
              {demoAccounts.map((account, index) => (
                <article
                  key={account.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.055] p-4 transition hover:border-white/20 hover:bg-white/[0.075]"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[0.63rem] text-white/35">
                          0{index + 1}
                        </span>
                        <h3 className="text-sm font-bold">{account.displayName}</h3>
                        <RoleBadge role={account.role} compact />
                      </div>
                      <p className="mt-1.5 text-xs leading-5 text-white/50">
                        {account.description}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[0.68rem]">
                        <span className="text-white/65">{account.email}</span>
                        <span className="text-brand-300">{account.password}</span>
                      </div>
                    </div>

                    <form action={quickSignInAction} className="shrink-0">
                      <input type="hidden" name="email" value={account.email} />
                      <input
                        type="hidden"
                        name="password"
                        value={account.password}
                      />
                      <input type="hidden" name="next" value={nextPath} />
                      <button
                        type="submit"
                        className="btn w-full min-h-9 border border-white/15 px-3.5 py-1.5 text-xs text-white hover:border-brand-300/40 hover:bg-brand-300/10 sm:w-auto"
                        aria-label={`Sign in as ${account.displayName}, ${account.role}`}
                      >
                        Use account
                        <svg
                          viewBox="0 0 16 16"
                          fill="none"
                          aria-hidden="true"
                          className="size-3"
                        >
                          <path
                            d="M3.5 8h9M9 4.5 12.5 8 9 11.5"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </form>
                  </div>
                </article>
              ))}
            </div>

            <div className="mt-5 rounded-xl border border-brand-300/15 bg-brand-300/[0.07] px-4 py-3">
              <div className="flex gap-3">
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-brand-300"
                >
                  <path
                    d="M8 1.75 13 3.9v3.65c0 3.2-2.05 5.5-5 6.7-2.95-1.2-5-3.5-5-6.7V3.9L8 1.75Z"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                  />
                </svg>
                <p className="text-[0.68rem] leading-4 text-white/55">
                  Check-out and incidents are human-reviewed. No automatic
                  penalties or physical door control are implemented.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
