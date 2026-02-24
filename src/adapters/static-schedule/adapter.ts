/**
 * Static Schedule Adapter — generates recurring events from RRULE-like schedule
 * rules stored in Source.config. Designed for kennels that operate on a consistent
 * schedule but have no scrapeable website (e.g., Facebook-only kennels).
 *
 * No network I/O — purely computational.
 */

import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { validateSourceConfig, parse12HourTime } from "../utils";

export interface StaticScheduleConfig {
  kennelTag: string;           // Kennel shortName for all generated events (e.g. "Rumson")
  rrule: string;               // RRULE string, e.g. "FREQ=WEEKLY;BYDAY=SA"
  startTime?: string;          // "10:17 AM" or "10:17" — normalized to HH:MM
  defaultTitle?: string;       // e.g. "Rumson H3 Weekly Run"
  defaultLocation?: string;    // e.g. "Rumson, NJ"
  defaultDescription?: string; // e.g. "Check Facebook for start location"
}

// Day abbreviation → JS Date.getUTCDay() number (Sunday=0)
const DAY_MAP: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

/**
 * Parse an RRULE string into structured parts.
 * Supports: FREQ, BYDAY (with optional nth prefix), INTERVAL, BYMONTHDAY.
 */
export function parseRRule(rrule: string): {
  freq: string;
  interval: number;
  byDay?: { day: number; nth?: number };
  byMonthDay?: number;
} {
  const parts: Record<string, string> = {};
  for (const segment of rrule.split(";")) {
    const [key, value] = segment.split("=");
    if (key && value) parts[key.toUpperCase()] = value.toUpperCase();
  }

  if (!parts.FREQ) throw new Error("RRULE missing FREQ");

  const freq = parts.FREQ;
  const interval = parts.INTERVAL ? Number.parseInt(parts.INTERVAL, 10) : 1;

  let byDay: { day: number; nth?: number } | undefined;
  if (parts.BYDAY) {
    // e.g. "SA", "2SA" (2nd Saturday), "-1FR" (last Friday)
    const match = /^(-?\d+)?([A-Z]{2})$/.exec(parts.BYDAY);
    if (!match) throw new Error(`Invalid BYDAY: ${parts.BYDAY}`);
    const dayNum = DAY_MAP[match[2]];
    if (dayNum === undefined) throw new Error(`Unknown day: ${match[2]}`);
    byDay = { day: dayNum, nth: match[1] ? Number.parseInt(match[1], 10) : undefined };
  }

  let byMonthDay: number | undefined;
  if (parts.BYMONTHDAY) {
    byMonthDay = Number.parseInt(parts.BYMONTHDAY, 10);
  }

  return { freq, interval, byDay, byMonthDay };
}

/**
 * Generate all occurrence dates within [windowStart, windowEnd] for a parsed RRULE.
 * Returns dates as YYYY-MM-DD strings.
 */
export function generateOccurrences(
  rule: ReturnType<typeof parseRRule>,
  windowStart: Date,
  windowEnd: Date,
): string[] {
  const dates: string[] = [];

  if (rule.freq === "WEEKLY" && rule.byDay) {
    // Walk through weeks in the window, finding the target day
    const targetDay = rule.byDay.day;
    const start = new Date(windowStart);

    // Find the first occurrence of targetDay on or after windowStart
    const startDow = start.getUTCDay();
    const daysUntilTarget = (targetDay - startDow + 7) % 7;

    const cursor = new Date(Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate() + daysUntilTarget,
      12, 0, 0, // UTC noon to avoid DST issues
    ));

    const intervalDays = rule.interval * 7;
    while (cursor <= windowEnd) {
      dates.push(formatDateUTC(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + intervalDays);
    }
  } else if (rule.freq === "MONTHLY") {
    if (rule.byDay?.nth !== undefined) {
      // Nth weekday of month (e.g., 2nd Saturday)
      const { day, nth } = rule.byDay;
      const cursor = new Date(Date.UTC(
        windowStart.getUTCFullYear(),
        windowStart.getUTCMonth(),
        1, 12, 0, 0,
      ));

      while (cursor <= windowEnd) {
        const date = nthWeekdayOfMonth(
          cursor.getUTCFullYear(),
          cursor.getUTCMonth(),
          day,
          nth!,
        );
        if (date && date >= windowStart && date <= windowEnd) {
          dates.push(formatDateUTC(date));
        }
        // Advance by interval months
        cursor.setUTCMonth(cursor.getUTCMonth() + rule.interval);
      }
    } else if (rule.byMonthDay) {
      // Specific day of month (e.g., 15th)
      const cursor = new Date(Date.UTC(
        windowStart.getUTCFullYear(),
        windowStart.getUTCMonth(),
        1, 12, 0, 0,
      ));

      while (cursor <= windowEnd) {
        const year = cursor.getUTCFullYear();
        const month = cursor.getUTCMonth();
        const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        const dayOfMonth = Math.min(rule.byMonthDay, daysInMonth);
        const date = new Date(Date.UTC(year, month, dayOfMonth, 12, 0, 0));
        if (date >= windowStart && date <= windowEnd) {
          dates.push(formatDateUTC(date));
        }
        cursor.setUTCMonth(cursor.getUTCMonth() + rule.interval);
      }
    } else if (rule.byDay) {
      // Every Nth month, on a specific weekday (pick first occurrence)
      // This is a less common pattern, treat it like "1st occurrence"
      const { day } = rule.byDay;
      const cursor = new Date(Date.UTC(
        windowStart.getUTCFullYear(),
        windowStart.getUTCMonth(),
        1, 12, 0, 0,
      ));

      while (cursor <= windowEnd) {
        const date = nthWeekdayOfMonth(
          cursor.getUTCFullYear(),
          cursor.getUTCMonth(),
          day,
          1,
        );
        if (date && date >= windowStart && date <= windowEnd) {
          dates.push(formatDateUTC(date));
        }
        cursor.setUTCMonth(cursor.getUTCMonth() + rule.interval);
      }
    }
  }

  return dates;
}

/** Find the nth weekday of a given month. Supports negative nth (-1 = last). */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  dayOfWeek: number,
  nth: number,
): Date | null {
  if (nth > 0) {
    // Count forward from 1st
    const first = new Date(Date.UTC(year, month, 1, 12, 0, 0));
    const firstDow = first.getUTCDay();
    const dayNum = 1 + ((dayOfWeek - firstDow + 7) % 7) + (nth - 1) * 7;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    if (dayNum > daysInMonth) return null;
    return new Date(Date.UTC(year, month, dayNum, 12, 0, 0));
  } else {
    // Count backward from last day
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const last = new Date(Date.UTC(year, month, daysInMonth, 12, 0, 0));
    const lastDow = last.getUTCDay();
    const dayNum = daysInMonth - ((lastDow - dayOfWeek + 7) % 7) + (nth + 1) * 7;
    if (dayNum < 1) return null;
    return new Date(Date.UTC(year, month, dayNum, 12, 0, 0));
  }
}

/** Format a UTC date as YYYY-MM-DD */
function formatDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Normalize a time string to "HH:MM" format.
 * Accepts "HH:MM" (24h) or "h:mm AM/PM" (12h).
 */
function normalizeTime(raw: string): string | undefined {
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  return parse12HourTime(raw);
}

export class StaticScheduleAdapter implements SourceAdapter {
  type = "STATIC_SCHEDULE" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    let config: StaticScheduleConfig;
    try {
      config = validateSourceConfig<StaticScheduleConfig>(
        source.config,
        "StaticScheduleAdapter",
        { kennelTag: "string", rrule: "string" },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid source config";
      return { events: [], errors: [message], errorDetails: { fetch: [{ message }] } };
    }

    const days = options?.days ?? 90;
    const now = new Date();
    const windowStart = new Date(now.getTime() - days * 86_400_000);
    const windowEnd = new Date(now.getTime() + days * 86_400_000);

    let rule: ReturnType<typeof parseRRule>;
    try {
      rule = parseRRule(config.rrule);
    } catch (err) {
      const message = `Invalid RRULE "${config.rrule}": ${err instanceof Error ? err.message : String(err)}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ message }] } };
    }

    const occurrences = generateOccurrences(rule, windowStart, windowEnd);

    const startTime = config.startTime
      ? normalizeTime(config.startTime)
      : undefined;

    const events: RawEventData[] = occurrences.map((date) => ({
      date,
      kennelTag: config.kennelTag,
      title: config.defaultTitle,
      description: config.defaultDescription,
      location: config.defaultLocation,
      startTime,
      sourceUrl: source.url,
    }));

    return {
      events,
      errors: [],
      diagnosticContext: {
        rrule: config.rrule,
        occurrencesGenerated: events.length,
        windowDays: days,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
      },
    };
  }
}
