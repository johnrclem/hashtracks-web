/**
 * Shared formatting helpers for Travel Mode components.
 */

/** Format a YYYY-MM-DD string as "Apr 14" (month + day, no weekday). */
export function formatDateCompact(dateStr: string): string {
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Count days between two YYYY-MM-DD strings. Returns at least 1. */
export function daysBetween(start: string, end: string): number {
  const s = new Date(start + "T12:00:00Z");
  const e = new Date(end + "T12:00:00Z");
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / (24 * 60 * 60 * 1000)));
}

/** Extract 1-2 character initials from a kennel name for the insignia badge. */
export function getKennelInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
