import type { Prisma } from "@/generated/prisma/client";
import { HIDE_STOPPED_SCHEDULE_RUNS } from "@/lib/event-filters";

export type ActivityStatus = "active" | "possibly-inactive" | "inactive" | "unknown";

const ACTIVE_DAYS = 90;
const INACTIVE_DAYS = 365;
const DAY_MS = 1000 * 60 * 60 * 24;

/** Normalize a Date to UTC noon to avoid DST boundary issues. */
function toUtcNoon(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0);
}

/**
 * The earliest last-run date (UTC noon) that still counts as active: within
 * the last 90 days, today included. `getActivityStatus` and
 * `activeKennelWhere` both use it, so the directory badge and SQL counts agree.
 */
export function activeSinceUtcNoon(now: Date = new Date()): Date {
  return new Date(toUtcNoon(now) - (ACTIVE_DAYS - 1) * DAY_MS);
}

/**
 * Compute activity status from a kennel's most recent event date.
 * Thresholds: <90 days = active, 90-365 = possibly-inactive, 365+ = inactive, null = unknown.
 * Both dates normalized to UTC noon per project convention.
 * A kennel with upcoming events is always considered active.
 */
export function getActivityStatus(lastEventDate: Date | null, hasUpcomingEvent?: boolean): ActivityStatus {
  if (hasUpcomingEvent) return "active";
  if (!lastEventDate) return "unknown";

  const now = new Date();
  const eventNoon = toUtcNoon(lastEventDate);
  if (eventNoon >= activeSinceUtcNoon(now).getTime()) return "active";

  const diffDays = Math.floor((toUtcNoon(now) - eventNoon) / DAY_MS);
  if (diffDays < INACTIVE_DAYS) return "possibly-inactive";
  return "inactive";
}

/**
 * Events that make a kennel "have an upcoming run": confirmed, canonical, on
 * or after today. Shared by the Kennel Directory's next-run query and
 * `activeKennelWhere`.
 */
export function upcomingConfirmedEventWhere(todayUtcNoon: Date) {
  return {
    date: { gte: todayUtcNoon },
    status: "CONFIRMED",
    isCanonical: true,
    ...HIDE_STOPPED_SCHEDULE_RUNS,
  } as const satisfies Prisma.EventWhereInput;
}

/**
 * Visible kennels that `getActivityStatus` would call active: a run in the
 * last 90 days or an upcoming confirmed run (including co-hosted ones).
 */
export function activeKennelWhere(now: Date = new Date()): Prisma.KennelWhereInput {
  const todayUtcNoon = new Date(toUtcNoon(now));
  return {
    isHidden: false,
    OR: [
      { lastEventDate: { gte: activeSinceUtcNoon(now) } },
      { eventKennels: { some: { event: upcomingConfirmedEventWhere(todayUtcNoon) } } },
    ],
  };
}
