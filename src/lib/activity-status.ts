export type ActivityStatus = "active" | "possibly-inactive" | "inactive" | "unknown";

const ACTIVE_DAYS = 90;
const INACTIVE_DAYS = 365;

/**
 * Compute activity status from a kennel's most recent event date.
 * Thresholds: <90 days = active, 90-365 = possibly-inactive, 365+ = inactive, null = unknown.
 */
export function getActivityStatus(lastEventDate: Date | null): ActivityStatus {
  if (!lastEventDate) return "unknown";

  const now = new Date();
  const diffMs = now.getTime() - lastEventDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < ACTIVE_DAYS) return "active";
  if (diffDays < INACTIVE_DAYS) return "possibly-inactive";
  return "inactive";
}
