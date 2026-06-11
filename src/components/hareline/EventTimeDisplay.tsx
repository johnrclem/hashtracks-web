"use client";

import { useTimePreference } from "@/components/providers/time-preference-provider";
import {
  composeUtcStart,
  formatTimeInZone,
  formatLocalTimeForDisplay,
  getTimezoneAbbreviation,
  getBrowserTimezone,
} from "@/lib/timezone";
import { formatTime, formatTimeRange } from "@/lib/format";

interface EventTimeDisplayProps {
  startTime: string;
  /** #2135 — local end time "HH:MM"; renders a "start – end" range when present. */
  endTime?: string | null;
  /** ISO string of the event date (UTC noon, e.g. event.date.toISOString()) */
  date: string;
  timezone: string | null;
}

/**
 * Timezone-aware start (and optional end) time display for event detail pages.
 * Respects the user's time preference (event local vs. browser local).
 * Falls back to plain HH:MM AM/PM formatting if timezone data is unavailable.
 */
export function EventTimeDisplay({ startTime, endTime, date, timezone }: EventTimeDisplayProps) {
  const { preference } = useTimePreference();
  const isUserLocal = preference === "USER_LOCAL";
  const displayTz = isUserLocal ? getBrowserTimezone() : (timezone ?? null);

  const dateUtc = timezone ? composeUtcStart(new Date(date), startTime, timezone) : null;

  const displayTimeStr =
    dateUtc && displayTz ? formatTimeInZone(dateUtc, displayTz) : formatTime(startTime);

  const endTimeStr = endTime
    ? formatLocalTimeForDisplay(date, endTime, timezone, displayTz)
    : null;

  const tzAbbrev =
    dateUtc && displayTz ? getTimezoneAbbreviation(dateUtc, displayTz) : "";

  return (
    <span suppressHydrationWarning>
      {formatTimeRange(displayTimeStr, endTimeStr)}
      {tzAbbrev && (
        <span className="ml-1 text-sm text-muted-foreground">{tzAbbrev}</span>
      )}
    </span>
  );
}
