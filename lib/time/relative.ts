import { formatCampusDate, formatCampusTime } from "@/lib/time/campus-time";

/** "just now", "5 min ago", "3 h ago", "yesterday at 14:20", or a date. */
export function formatRelative(instant: string, now = Date.now()): string {
  const diff = now - Date.parse(instant);
  const minute = 60_000;

  if (diff < minute) {
    return "just now";
  }

  if (diff < 60 * minute) {
    return `${Math.floor(diff / minute)} min ago`;
  }

  if (diff < 24 * 60 * minute) {
    return `${Math.floor(diff / (60 * minute))} h ago`;
  }

  if (diff < 48 * 60 * minute) {
    return `yesterday at ${formatCampusTime(instant)}`;
  }

  return formatCampusDate(instant);
}
