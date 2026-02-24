/**
 * Static Schedule Adapter — generates recurring events from RRULE-like schedule
 * rules stored in Source.config. Designed for kennels that operate on a consistent
 * schedule but have no scrapeable website (e.g., Facebook-only kennels).
 *
 * No network I/O — purely computational.
 */

import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { validateSourceConfig } from "../utils";

/** Configuration shape for a STATIC_SCHEDULE source. */
export interface StaticScheduleConfig {
  kennelTag: string;           // Kennel shortName for all generated events (e.g. "Rumson")
  rrule: string;               // RRULE string, e.g. "FREQ=WEEKLY;BYDAY=SA"
  anchorDate?: string;         // YYYY-MM-DD — a known past occurrence, stabilizes INTERVAL > 1
  startTime?: string;          // "HH:MM" 24-hour format (e.g. "10:17", "19:00")
  defaultTitle?: string;       // e.g. "Rumson H3 Weekly Run"
  defaultLocation?: string;    // e.g. "Rumson, NJ"
  defaultDescription?: string; // e.g. "Check Facebook for start location"
}

/** Supported FREQ values. Other values (DAILY, YEARLY, etc.) are rejected. */
const SUPPORTED_FREQS = new Set(["WEEKLY", "MONTHLY"]);

/** Day abbreviation to JS Date.getUTCDay() number (Sunday=0). */
const DAY_MAP: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

/**
 * Parse INTERVAL from RRULE parts. Returns 1 if not specified.
 * @throws {Error} If INTERVAL is not a finite positive integer.
 */
function parseInterval(parts: Record<string, string>): number {
  if (!parts.INTERVAL) return 1;
  const interval = Number.parseInt(parts.INTERVAL, 10);
  if (!Number.isFinite(interval) || interval < 1) {
    throw new Error(`Invalid INTERVAL: ${parts.INTERVAL} (must be >= 1)`);
  }
  return interval;
}

/**
 * Parse BYDAY from RRULE parts. Supports formats like "SA", "2SA" (2nd Saturday),
 * "-1FR" (last Friday). Returns undefined if BYDAY is not present.
 * @throws {Error} If BYDAY format is invalid, day abbreviation is unknown, or nth is 0.
 */
function parseByDay(parts: Record<string, string>): { day: number; nth?: number } | undefined {
  if (!parts.BYDAY) return undefined;
  const match = /^(-?\d+)?([A-Z]{2})$/.exec(parts.BYDAY);
  if (!match) throw new Error(`Invalid BYDAY: ${parts.BYDAY}`);
  const dayNum = DAY_MAP[match[2]];
  if (dayNum === undefined) throw new Error(`Unknown day: ${match[2]}`);
  if (match[1]) {
    const nth = Number.parseInt(match[1], 10);
    if (nth === 0) throw new Error("BYDAY nth position cannot be 0");
    return { day: dayNum, nth };
  }
  return { day: dayNum };
}

/**
 * Parse BYMONTHDAY from RRULE parts. Returns undefined if not present.
 * @throws {Error} If BYMONTHDAY is not a valid day of month (1-31).
 */
function parseByMonthDay(parts: Record<string, string>): number | undefined {
  if (!parts.BYMONTHDAY) return undefined;
  const byMonthDay = Number.parseInt(parts.BYMONTHDAY, 10);
  if (!Number.isFinite(byMonthDay) || byMonthDay < 1 || byMonthDay > 31) {
    throw new Error(`Invalid BYMONTHDAY: ${parts.BYMONTHDAY} (must be 1-31)`);
  }
  return byMonthDay;
}

/**
 * Parse an RRULE string into structured parts.
 * Supports: FREQ (WEEKLY|MONTHLY), BYDAY (with optional nth prefix), INTERVAL, BYMONTHDAY.
 * Whitespace around semicolons and equals signs is trimmed.
 *
 * @throws {Error} On missing FREQ, unsupported FREQ, invalid INTERVAL/BYMONTHDAY/BYDAY values.
 */
export function parseRRule(rrule: string): {
  freq: string;
  interval: number;
  byDay?: { day: number; nth?: number };
  byMonthDay?: number;
} {
  const parts: Record<string, string> = {};
  for (const segment of rrule.split(";")) {
    const eqIdx = segment.indexOf("=");
    if (eqIdx < 0) continue;
    const key = segment.slice(0, eqIdx).trim().toUpperCase();
    const value = segment.slice(eqIdx + 1).trim().toUpperCase();
    if (key && value) parts[key] = value;
  }

  if (!parts.FREQ) throw new Error("RRULE missing FREQ");
  const freq = parts.FREQ;
  if (!SUPPORTED_FREQS.has(freq)) {
    throw new Error(`Unsupported FREQ: ${freq} (supported: WEEKLY, MONTHLY)`);
  }

  const interval = parseInterval(parts);
  const byDay = parseByDay(parts);
  const byMonthDay = parseByMonthDay(parts);

  if (freq === "WEEKLY" && !byDay) {
    throw new Error("WEEKLY RRULE requires BYDAY");
  }

  return { freq, interval, byDay, byMonthDay };
}

/**
 * Generate weekly occurrence dates within a window. Supports anchor-based alignment
 * for intervals > 1 (e.g., biweekly) so dates remain stable across shifting windows.
 */
function generateWeeklyDates(
  targetDay: number,
  interval: number,
  windowStart: Date,
  windowEnd: Date,
  anchorDate?: string,
): string[] {
  const dates: string[] = [];
  const intervalDays = interval * 7;
  let cursor: Date;

  if (anchorDate && interval > 1) {
    const anchor = new Date(anchorDate + "T12:00:00Z");
    const anchorMs = anchor.getTime();
    const windowStartMs = windowStart.getTime();
    const intervalMs = intervalDays * 86_400_000;

    if (anchorMs <= windowStartMs) {
      const stepCount = Math.floor((windowStartMs - anchorMs) / intervalMs);
      cursor = new Date(anchorMs + stepCount * intervalMs);
    } else {
      const stepCount = Math.ceil((anchorMs - windowStartMs) / intervalMs);
      cursor = new Date(anchorMs - stepCount * intervalMs);
    }
    if (cursor < windowStart) {
      cursor = new Date(cursor.getTime() + intervalMs);
    }
  } else {
    const start = new Date(windowStart);
    const daysUntilTarget = (targetDay - start.getUTCDay() + 7) % 7;
    cursor = new Date(Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate() + daysUntilTarget,
      12, 0, 0,
    ));
  }

  while (cursor <= windowEnd) {
    dates.push(formatDateUTC(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + intervalDays);
  }
  return dates;
}

/**
 * Generate monthly dates for the nth weekday of the month (e.g., 2nd Saturday).
 * Supports negative nth for counting from end of month (e.g., -1 = last).
 */
function generateMonthlyNthWeekdayDates(
  day: number,
  nth: number,
  interval: number,
  windowStart: Date,
  windowEnd: Date,
): string[] {
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(
    windowStart.getUTCFullYear(),
    windowStart.getUTCMonth(),
    1, 12, 0, 0,
  ));

  while (cursor <= windowEnd) {
    const date = nthWeekdayOfMonth(cursor.getUTCFullYear(), cursor.getUTCMonth(), day, nth);
    if (date && date >= windowStart && date <= windowEnd) {
      dates.push(formatDateUTC(date));
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + interval);
  }
  return dates;
}

/**
 * Generate monthly dates for a specific day of the month (e.g., the 15th).
 * Clamps to the last day of the month when the target day exceeds the month length.
 */
function generateMonthlyByMonthDayDates(
  byMonthDay: number,
  interval: number,
  windowStart: Date,
  windowEnd: Date,
): string[] {
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(
    windowStart.getUTCFullYear(),
    windowStart.getUTCMonth(),
    1, 12, 0, 0,
  ));

  while (cursor <= windowEnd) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const dayOfMonth = Math.min(byMonthDay, daysInMonth);
    const date = new Date(Date.UTC(year, month, dayOfMonth, 12, 0, 0));
    if (date >= windowStart && date <= windowEnd) {
      dates.push(formatDateUTC(date));
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + interval);
  }
  return dates;
}

/**
 * Generate monthly dates for a specific weekday without an nth position.
 * Uses the first occurrence of that weekday in the month.
 */
function generateMonthlyByWeekdayDates(
  day: number,
  interval: number,
  windowStart: Date,
  windowEnd: Date,
): string[] {
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(
    windowStart.getUTCFullYear(),
    windowStart.getUTCMonth(),
    1, 12, 0, 0,
  ));

  while (cursor <= windowEnd) {
    const date = nthWeekdayOfMonth(cursor.getUTCFullYear(), cursor.getUTCMonth(), day, 1);
    if (date && date >= windowStart && date <= windowEnd) {
      dates.push(formatDateUTC(date));
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + interval);
  }
  return dates;
}

/**
 * Generate all occurrence dates within [windowStart, windowEnd] for a parsed RRULE.
 * Returns dates as YYYY-MM-DD strings.
 *
 * @param anchorDate - Optional YYYY-MM-DD anchor for stable interval > 1 generation.
 *   When interval > 1, the cursor is aligned to the anchor so occurrences don't shift
 *   as the window moves.
 */
export function generateOccurrences(
  rule: ReturnType<typeof parseRRule>,
  windowStart: Date,
  windowEnd: Date,
  anchorDate?: string,
): string[] {
  if (rule.freq === "WEEKLY" && rule.byDay) {
    return generateWeeklyDates(rule.byDay.day, rule.interval, windowStart, windowEnd, anchorDate);
  }
  if (rule.freq === "MONTHLY") {
    if (rule.byDay?.nth !== undefined) {
      return generateMonthlyNthWeekdayDates(rule.byDay.day, rule.byDay.nth, rule.interval, windowStart, windowEnd);
    }
    if (rule.byMonthDay) {
      return generateMonthlyByMonthDayDates(rule.byMonthDay, rule.interval, windowStart, windowEnd);
    }
    if (rule.byDay) {
      return generateMonthlyByWeekdayDates(rule.byDay.day, rule.interval, windowStart, windowEnd);
    }
  }
  return [];
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

/** Format a UTC date as YYYY-MM-DD. */
function formatDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Validate a time string is in strict HH:MM 24-hour format.
 * Returns the time string if valid, undefined otherwise.
 */
function normalizeTime(raw: string): string | undefined {
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  return undefined;
}

/**
 * Adapter for kennels that operate on a consistent, predictable schedule but lack
 * a scrapeable website (e.g., Facebook-only groups). Generates recurring events
 * purely from config — no network I/O.
 */
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
    const todayNoon = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0);
    const windowStart = new Date(todayNoon - days * 86_400_000);
    const windowEnd = new Date(todayNoon + days * 86_400_000);

    let rule: ReturnType<typeof parseRRule>;
    try {
      rule = parseRRule(config.rrule);
    } catch (err) {
      const message = `Invalid RRULE "${config.rrule}": ${err instanceof Error ? err.message : String(err)}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ message }] } };
    }

    const occurrences = generateOccurrences(rule, windowStart, windowEnd, config.anchorDate);

    if (occurrences.length === 0) {
      const message = `RRULE "${config.rrule}" generated 0 events in ${days}-day window — check schedule configuration`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ message }] } };
    }

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
