import type { ReactNode } from "react";
import {
  BOOKING_STATUS_LABELS,
  ROLE_LABELS,
  ROLE_SHORT_LABELS,
  type BookingStatus,
  type Role,
} from "@/lib/domain";

const roleStyles: Record<Role, string> = {
  student: "border-brand-600/20 bg-brand-50 text-brand-700",
  manager: "border-ink-700/15 bg-sand-100 text-ink-800",
  admin: "border-flag-amber/20 bg-flag-amber-bg text-flag-amber",
};

export function RoleBadge({
  role,
  compact = false,
}: {
  role: Role;
  compact?: boolean;
}) {
  return (
    <span className={`chip ${roleStyles[role]}`}>
      <span className="status-dot" aria-hidden="true" />
      {compact ? ROLE_SHORT_LABELS[role] : ROLE_LABELS[role]}
    </span>
  );
}

export function StatusChip({
  tone,
  children,
}: {
  tone: "green" | "amber" | "red" | "neutral";
  children: ReactNode;
}) {
  const styles = {
    green: "border-flag-green/20 bg-flag-green-bg text-flag-green",
    amber: "border-flag-amber/20 bg-flag-amber-bg text-flag-amber",
    red: "border-flag-red/20 bg-flag-red-bg text-flag-red",
    neutral: "border-ink-950/10 bg-sand-100 text-ink-700",
  }[tone];

  return (
    <span className={`chip ${styles}`}>
      <span className="status-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export function BookingStatusChip({ status }: { status: BookingStatus }) {
  const tone =
    status === "approved" || status === "checked_in" || status === "completed"
      ? "green"
      : status === "pending" || status === "waitlisted"
        ? "amber"
        : status === "rejected" || status === "incident"
          ? "red"
          : "neutral";

  return <StatusChip tone={tone}>{BOOKING_STATUS_LABELS[status]}</StatusChip>;
}
