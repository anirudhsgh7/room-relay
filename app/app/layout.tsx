import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand";
import { RoleBadge } from "@/components/badges";
import {
  WorkspaceMobileNav,
  WorkspaceNav,
} from "@/components/workspace-nav";
import { signOutAction } from "@/app/app/actions";
import { requireCurrentProfile } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/domain";

export const metadata: Metadata = {
  title: "Workspace",
  description: "RoomRelay room discovery and request workspace.",
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
          <p className="mt-4 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-white/35">
            Close-out workspace · v0.5
          </p>
        </div>

        <WorkspaceNav role={profile.role} />

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
          <p className="mt-3 px-1 text-[0.58rem] leading-4 text-white/25">
            {ROLE_LABELS[profile.role]} · Server-verified session
          </p>
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
        <WorkspaceMobileNav role={profile.role} />

        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-7 sm:py-9 lg:px-10 lg:py-12">
          {children}
        </main>
      </div>
    </div>
  );
}
