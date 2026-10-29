import type { Role } from "@/lib/domain";

export interface NavCounts {
  unread: number;
  toReview: number;
  openIssues: number;
}

export interface NavigationItem {
  label: string;
  href: string;
  count?: number;
  /** Paths that also mark this item as current (e.g. a detail page). */
  also?: string[];
}

export interface NavigationGroup {
  label: string | null;
  items: NavigationItem[];
}

/**
 * The workspace navigation is role-shaped. Students use discovery and the
 * simulator as part of their booking journey; managers and admins use the
 * management tools and read the access log. Staff can still open a direct
 * discovery or simulator URL when demoing the student flow.
 */
export function navigationFor(
  role: Role,
  counts: NavCounts,
): NavigationGroup[] {
  if (role === "student") {
    return [
      {
        label: null,
        items: [
          { label: "Home", href: "/app" },
          { label: "Find a room", href: "/app/rooms" },
          { label: "My bookings", href: "/app/bookings" },
          { label: "Check in", href: "/app/access" },
          {
            label: "Notifications",
            href: "/app/notifications",
            count: counts.unread,
          },
        ],
      },
    ];
  }

  return [
    {
      label: null,
      items: [
        { label: "Home", href: "/app" },
        {
          label: "Notifications",
          href: "/app/notifications",
          count: counts.unread,
        },
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
        {
          label: "Reported issues",
          href: "/app/incidents",
          count: counts.openIssues,
        },
      ],
    },
    {
      label: "Campus",
      items: [{ label: "Access log", href: "/app/access/history" }],
    },
  ];
}
