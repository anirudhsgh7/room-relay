"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/domain";

export interface NavCounts {
  unread: number;
  toReview: number;
  openIssues: number;
}

interface NavigationItem {
  label: string;
  href: string;
  count?: number;
  /** Paths that also mark this item as current (e.g. a detail page). */
  also?: string[];
}

interface NavigationGroup {
  label: string | null;
  items: NavigationItem[];
}

function navigationFor(role: Role, counts: NavCounts): NavigationGroup[] {
  if (role === "student") {
    return [
      {
        label: null,
        items: [
          { label: "Home", href: "/app" },
          { label: "Find a room", href: "/app/rooms" },
          { label: "My bookings", href: "/app/bookings" },
          { label: "Check in", href: "/app/access" },
          { label: "Notifications", href: "/app/notifications", count: counts.unread },
        ],
      },
    ];
  }

  return [
    {
      label: null,
      items: [
        { label: "Home", href: "/app" },
        { label: "Notifications", href: "/app/notifications", count: counts.unread },
      ],
    },
    {
      label: "Manage",
      items: [
        {
          label: "Requests to review",
          href: "/app/manager/queue",
          count: counts.toReview,
          also: ["/app/manager/requests"],
        },
        {
          label: role === "admin" ? "Rooms and rules" : "My rooms",
          href: "/app/admin/rooms",
        },
        { label: "Reported issues", href: "/app/incidents", count: counts.openIssues },
      ],
    },
    {
      label: "Campus",
      items: [
        { label: "Find a room", href: "/app/rooms" },
        { label: "Access log", href: "/app/access/history" },
        { label: "Tap simulator", href: "/app/access" },
      ],
    },
  ];
}

function isCurrent(pathname: string, item: NavigationItem): boolean {
  if (item.href === "/app") {
    return pathname === "/app";
  }

  if (item.href === "/app/access") {
    return pathname === "/app/access";
  }

  return [item.href, ...(item.also ?? [])].some(
    (href) => pathname === href || pathname.startsWith(`${href}/`),
  );
}

function CountBadge({ count, dark }: { count?: number; dark: boolean }) {
  if (!count) {
    return null;
  }

  return (
    <span
      className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[0.68rem] font-bold tabular-nums ${
        dark ? "bg-brand-300 text-ink-950" : "bg-ink-950 text-white"
      }`}
    >
      {count > 99 ? "99+" : count}
      <span className="sr-only"> new</span>
    </span>
  );
}

export function WorkspaceNav({ role, counts }: { role: Role; counts: NavCounts }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-5" aria-label="Workspace">
      {navigationFor(role, counts).map((group, index) => (
        <div key={group.label ?? index} className={index > 0 ? "mt-6" : undefined}>
          {group.label ? (
            <p className="px-3 text-xs font-semibold text-white/40">{group.label}</p>
          ) : null}
          <ul className={`space-y-0.5 ${group.label ? "mt-2" : ""}`}>
            {group.items.map((item) => {
              const active = isCurrent(pathname, item);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={
                      active
                        ? "flex items-center justify-between gap-3 rounded-xl bg-white/[0.1] px-3 py-2.5 text-sm font-semibold text-white shadow-[inset_3px_0_0_var(--color-brand-400)]"
                        : "flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm text-white/70 transition hover:bg-white/[0.06] hover:text-white"
                    }
                  >
                    {item.label}
                    <CountBadge count={item.count} dark />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <p className="mx-3 mt-8 border-t border-white/[0.08] pt-4 text-xs leading-5 text-white/40">
        Door access is simulated in this version. No physical lock is opened.
      </p>
    </nav>
  );
}

export function WorkspaceMobileNav({ role, counts }: { role: Role; counts: NavCounts }) {
  const pathname = usePathname();
  const items = navigationFor(role, counts).flatMap((group) => group.items);

  return (
    <nav
      className="flex gap-1 overflow-x-auto border-b border-sand-200 bg-sand-50/95 px-3 py-2 backdrop-blur lg:hidden"
      aria-label="Workspace"
    >
      {items.map((item) => {
        const active = isCurrent(pathname, item);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold ${
              active ? "bg-ink-950 text-white" : "text-ink-700 hover:bg-sand-100"
            }`}
          >
            {item.label}
            <CountBadge count={item.count} dark={active} />
          </Link>
        );
      })}
    </nav>
  );
}
