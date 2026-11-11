/**
 * Date presets for the homepage search. Dates are the visitor's local
 * calendar days as YYYY-MM-DD, the format Travel search URLs take.
 */

import { localYmd } from "@/lib/travel/url";

export type HomeDatePreset = "week" | "weekend";

export interface DateRange {
  startDate: string;
  endDate: string;
}

/** Calendar arithmetic on local days (safe across daylight-saving changes). */
function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * "This week" is today plus the next six days. "This weekend" is Friday
 * through Sunday: the coming one, or the current one from Friday on.
 */
export function presetDateRange(preset: HomeDatePreset, today: Date): DateRange {
  if (preset === "week") {
    return { startDate: localYmd(today), endDate: localYmd(addDays(today, 6)) };
  }
  const weekday = today.getDay(); // 0 = Sunday … 6 = Saturday
  const inWeekend = weekday === 0 || weekday >= 5;
  const start = inWeekend ? today : addDays(today, 5 - weekday);
  const end = addDays(today, (7 - weekday) % 7);
  return { startDate: localYmd(start), endDate: localYmd(end) };
}
