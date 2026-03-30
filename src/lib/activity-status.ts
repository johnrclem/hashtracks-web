export type ActivityStatus = "active" | "possibly-inactive" | "inactive" | "unknown";

const ACTIVE_DAYS = 90;
const INACTIVE_DAYS = 365;

/** Normalize a Date to UTC noon to avoid DST boundary issues. */
function toUtcNoon(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0);
}

/**
 * Compute activity status from a kennel's most recent event date.
 * Thresholds: <90 days = active, 90-365 = possibly-inactive, 365+ = inactive, null = unknown.
 * Both dates normalized to UTC noon per project convention.
 */
export function getActivityStatus(lastEventDate: Date | null): ActivityStatus {
  if (!lastEventDate) return "unknown";

  const nowNoon = toUtcNoon(new Date());
  const eventNoon = toUtcNoon(lastEventDate);
  const diffDays = Math.floor((nowNoon - eventNoon) / (1000 * 60 * 60 * 24));

  if (diffDays < ACTIVE_DAYS) return "active";
  if (diffDays < INACTIVE_DAYS) return "possibly-inactive";
  return "inactive";
}
