/** Date helpers shared by the audit dashboard, deep-dive queue and prompt inputs. */
import { formatYmdInTimezone } from "@/lib/timezone";

/** Dashboard bucketing timezone. */
export const AUDIT_TZ = "America/New_York";

/** Bucket a date into `YYYY-MM-DD` in America/New_York. */
export function easternDate(d: Date): string {
  return formatYmdInTimezone(d, AUDIT_TZ);
}

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

/** Age of `lastAt` in hours and whether it is past `warnHours`. A missing timestamp counts as stale. */
export function computeStaleness(
  lastAt: Date | null,
  warnHours: number,
): { ageHours: number | null; stale: boolean } {
  if (!lastAt) return { ageHours: null, stale: true };
  const ageHours = (Date.now() - lastAt.getTime()) / 3_600_000;
  return { ageHours, stale: ageHours > warnHours };
}
