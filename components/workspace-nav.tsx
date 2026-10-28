"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/domain";

interface NavigationItem {
  label: string;
  href?: string;
  detail: string;
}

function navigationFor(role: Role): NavigationItem[] {
  return [
    { label: "Overview", href: "/app", detail: "Home" },
    { label: "Room discovery", href: "/app/rooms", detail: "Phase 2" },
    ...(role === "student"
      ? [{ label: "My requests", href: "/app/bookings", detail: "Phase 2" }]
      : []),
    ...(role === "manager" || role === "admin"
      ? [
          {
            label: "Manager queue",
            href: "/app/manager/queue",
            detail: "Phase 3",
          },
          { label: "Incidents", href: "/app/incidents", detail: "Phase 5" },
        ]
      : []),
    { label: "Access checks", href: "/app/access", detail: "Phase 4" },
    {
      label: "Access history",
      href: "/app/access/history",
      detail: "Phase 4",
    },
    { label: "Audit timeline", detail: "Phase 5" },
  ];
}

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/app") {
    return pathname === "/app";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function WorkspaceNav({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 px-3 py-5" aria-label="Workspace">
      <p className="px-3 text-[0.6rem] font-bold uppercase tracking-[0.18em] text-white/30">
        Workspace
      </p>
      <ul className="mt-3 space-y-1">
        {navigationFor(role).map((item) => {
          const active = item.href ? isCurrent(pathname, item.href) : false;

          return (
            <li key={item.label}>
              {item.href ? (
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "flex items-center justify-between gap-3 rounded-xl bg-white/[0.09] px-3 py-2.5 text-sm font-semibold text-white shadow-[inset_2px_0_0_var(--color-brand-400)]"
                      : "flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm text-white/65 transition hover:bg-white/[0.05] hover:text-white"
                  }
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      className={`size-1.5 rounded-full ${
                        active ? "bg-brand-300" : "border border-white/25"
                      }`}
                    />
                    {item.label}
                  </span>
                  <span
                    className={`text-[0.58rem] font-bold uppercase tracking-wider ${
                      active ? "text-brand-300" : "text-white/25"
                    }`}
                  >
                    {item.detail}
                  </span>
                </Link>
              ) : (
                <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm text-white/40">
                  <span className="flex items-center gap-2.5">
                    <span className="size-1.5 rounded-full border border-white/20" />
                    {item.label}
                  </span>
                  <span className="text-[0.58rem] font-bold uppercase tracking-wider text-white/25">
                    {item.detail}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mx-3 mt-7 rounded-xl border border-white/[0.08] bg-white/[0.035] p-3.5">
        <p className="text-[0.6rem] font-bold uppercase tracking-[0.16em] text-brand-300">
          Phase 5 note
        </p>
        <p className="mt-2 text-xs leading-5 text-white/45">
          Check-out and incidents are human-reviewed. Access checks remain
          software simulations with no physical door connected.
        </p>
      </div>
    </nav>
  );
}

export function WorkspaceMobileNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = navigationFor(role).filter((item) => item.href);

  return (
    <nav
      className="flex gap-1 overflow-x-auto border-b border-sand-200 bg-sand-50/95 px-3 py-2 backdrop-blur lg:hidden"
      aria-label="Workspace"
    >
      {items.map((item) =>
        item.href ? (
          <Link
            key={item.label}
            href={item.href}
            aria-current={
              isCurrent(pathname, item.href) ? "page" : undefined
            }
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${
              isCurrent(pathname, item.href)
                ? "bg-ink-950 text-white"
                : "text-ink-700 hover:bg-sand-100"
            }`}
          >
            {item.label}
          </Link>
        ) : (
          <span
            key={item.label}
            className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium text-ink-600/55"
          >
            {item.label} · {item.detail}
          </span>
        ),
      )}
    </nav>
  );
}
