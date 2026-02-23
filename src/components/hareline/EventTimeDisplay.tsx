"use client";

import { useTimePreference } from "@/components/providers/time-preference-provider";
import {
  composeUtcStart,
  formatTimeInZone,
  getTimezoneAbbreviation,
  getBrowserTimezone,
} from "@/lib/timezone";
import { formatTime } from "@/lib/format";

interface EventTimeDisplayProps {
  startTime: string;
  /** ISO string of the event date (UTC noon, e.g. event.date.toISOString()) */
  date: string;
  timezone: string | null;
}

/**
 * Timezone-aware start time display for event detail pages.
 * Respects the user's time preference (event local vs. browser local).
 * Falls back to plain HH:MM AM/PM formatting if timezone data is unavailable.
 */
export function EventTimeDisplay({ startTime, date, timezone }: EventTimeDisplayProps) {
  const { preference } = useTimePreference();
  const isUserLocal = preference === "USER_LOCAL";
  const displayTz = isUserLocal ? getBrowserTimezone() : (timezone ?? null);

  const dateUtc = timezone ? composeUtcStart(new Date(date), startTime, timezone) : null;

  const displayTimeStr =
    dateUtc && displayTz ? formatTimeInZone(dateUtc, displayTz) : formatTime(startTime);

  const tzAbbrev =
    dateUtc && displayTz ? getTimezoneAbbreviation(dateUtc, displayTz) : "";

  return (
    <span suppressHydrationWarning>
      {displayTimeStr}
      {tzAbbrev && (
        <span className="ml-1 text-sm text-muted-foreground">{tzAbbrev}</span>
      )}
    </span>
  );
}
