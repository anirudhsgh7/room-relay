import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand";
import { RoleBadge } from "@/components/badges";
import {
  WorkspaceMobileNav,
  WorkspaceNav,
} from "@/components/workspace-nav";
import { signOutAction } from "@/app/app/actions";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import {
  ASSISTANT_GREETING,
  assistantSuggestions,
} from "@/lib/assistant/respond";
import { requireCurrentProfile } from "@/lib/auth/session";
import { getDatabase } from "@/lib/db/client";
import { maybeRunReminderSweep } from "@/lib/notifications/reminders";
import { getWorkspaceCounts } from "@/lib/workspace/counts";

export const metadata: Metadata = {
  title: "Workspace",
  description: "Find rooms, manage bookings, and follow every request in RoomRelay.",
};

export const dynamic = "force-dynamic";

function initials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export default async function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const profile = await requireCurrentProfile();
  const db = getDatabase();
  // Reminders need no separate scheduler: page loads deliver anything due,
  // at most once a minute per server process.
  await maybeRunReminderSweep(db);
  const counts = await getWorkspaceCounts(db, profile);

  return (
    <div className="min-h-screen bg-sand-50 lg:grid lg:grid-cols-[17.5rem_1fr]">
      <aside className="hidden min-h-screen flex-col bg-ink-950 text-white lg:sticky lg:top-0 lg:flex lg:h-screen">
        <div className="border-b border-white/[0.08] px-6 py-6">
          <Link href="/" aria-label="RoomRelay home" className="inline-flex">
            <span className="flex items-center gap-2.5">
              <BrandMark tone="dark" size="sm" />
              <span className="text-[1.02rem] font-bold tracking-[-0.025em] text-white">
                Room<span className="text-brand-300">Relay</span>
              </span>
            </span>
          </Link>
        </div>

        <WorkspaceNav role={profile.role} counts={counts} />

        <div className="border-t border-white/[0.08] p-3">
          <div className="rounded-xl bg-white/[0.04] p-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-300/15 font-mono text-xs font-bold text-brand-300">
                {initials(profile.displayName)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-white">
                  {profile.displayName}
                </p>
                <p className="mt-0.5 truncate text-[0.65rem] text-white/40">
                  {profile.email}
                </p>
              </div>
            </div>
            <div className="mt-3">
              <RoleBadge role={profile.role} compact />
            </div>
            <form action={signOutAction} className="mt-3">
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-white/70 transition hover:border-white/20 hover:bg-white/[0.05] hover:text-white"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                  className="size-3.5"
                >
                  <path
                    d="M6.5 3.5h-3v9h3M9.5 5.5 12 8l-2.5 2.5M6.5 8H12"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-sand-200 bg-sand-50/95 px-4 py-3 backdrop-blur lg:hidden">
          <Link href="/" aria-label="RoomRelay home" className="flex items-center gap-2">
            <BrandMark size="sm" tone="dark" />
            <span className="text-sm font-bold tracking-tight text-ink-950">
              RoomRelay
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/app/notifications"
              className="relative inline-flex size-9 items-center justify-center rounded-full border border-sand-200 bg-white text-ink-700"
              aria-label={
                counts.unread > 0
                  ? `Notifications, ${counts.unread} unread`
                  : "Notifications"
              }
            >
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="size-4">
                <path
                  d="M4 11.5V7a4 4 0 1 1 8 0v4.5l1 1H3l1-1ZM6.5 14h3"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {counts.unread > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-flag-red ring-2 ring-sand-50" />
              ) : null}
            </Link>
            <RoleBadge role={profile.role} compact />
            <form action={signOutAction}>
              <button
                type="submit"
                className="inline-flex size-9 items-center justify-center rounded-full border border-sand-200 bg-white text-ink-700"
                aria-label="Sign out"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                  className="size-4"
                >
                  <path
                    d="M6.5 3.5h-3v9h3M9.5 5.5 12 8l-2.5 2.5M6.5 8H12"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </form>
          </div>
        </header>
        <WorkspaceMobileNav role={profile.role} counts={counts} />

        <main className="mx-auto max-w-6xl px-4 pt-6 pb-28 sm:px-7 sm:pt-9 lg:px-10 lg:pt-12">
          {children}
        </main>
        <AssistantPanel
          greeting={ASSISTANT_GREETING[profile.role]}
          starters={assistantSuggestions(profile.role)}
        />
      </div>
    </div>
  );
}
