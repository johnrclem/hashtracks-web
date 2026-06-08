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
import { parseRRule } from "./rrule-parser";
import type { ParsedRRule } from "./rrule-parser";

// Re-export the pure RRULE parser from its leaf module for callers that still
// import from this file (Travel Mode projection, the existing test surface).
export { parseRRule } from "./rrule-parser";
export type { ParsedRRule } from "./rrule-parser";
import {
  generateLunarOccurrences,
  ANCHOR_WEEKDAYS,
  ANCHOR_RULES,
  type LunarConfig,
} from "./lunar";
import { isValidTimezone } from "@/lib/timezone";

/**
 * Configuration shape for a STATIC_SCHEDULE source.
 *
 * Exactly one of `rrule` OR `lunar` must be set — the adapter and the admin
 * `validateStaticScheduleConfig` validator both enforce this XOR. RRULE-mode
 * generates calendar-rule occurrences (FREQ=WEEKLY|MONTHLY etc.). Lunar-mode
 * generates occurrences anchored to astronomical full or new moons in the
 * kennel's timezone, with optional snap-to-weekday for kennels that run
 * "Friday/Saturday near full moon" rather than on the exact phase day.
 */
export interface StaticScheduleConfig {
  kennelTag: string;           // Kennel shortName for all generated events (e.g. "Rumson")
  rrule?: string;              // RRULE string, e.g. "FREQ=WEEKLY;BYDAY=SA". XOR with `lunar`.
  lunar?: LunarConfig;         // Lunar-phase recurrence config. XOR with `rrule`.
  anchorDate?: string;         // YYYY-MM-DD — a known past occurrence, stabilizes INTERVAL > 1
  /**
   * Run number AT `anchorDate`. When set together with `anchorDate` on a
   * WEEKLY rule, every generated occurrence gets a computed `runNumber`
   * (`startRunNumber + steps` from the anchor). Opt-in and additive — sources
   * without it emit no run number, exactly as before. Ignored for MONTHLY /
   * lunar rules (a fixed day-delta can't map to a run count there). Reference:
   * PFH3 anchored to Trail #1184 @ 2019-11-20 (#2043).
   */
  startRunNumber?: number;
  startTime?: string;          // "HH:MM" 24-hour format (e.g. "10:17", "19:00")
  defaultTitle?: string;       // e.g. "Rumson H3 Weekly Run"
  defaultLocation?: string;    // e.g. "Rumson, NJ"
  defaultDescription?: string; // e.g. "Check Facebook for start location"
  /**
   * Title template with date-derived tokens. When present, it overrides
   * `defaultTitle`. Tokens (case-sensitive):
   *   {dayName}    → "Sunday"
   *   {monthName}  → "May"
   *   {date}       → "May 3"
   *   {iso}        → "2026-05-03"
   * Unknown tokens are left literal so typos surface visibly.
   *
   * No schedule-semantic tokens (e.g. nth-of-month) — those can lie about
   * the schedule on weekly rules. Encode "1st Sunday" / "3rd Sunday" intent
   * as literal text on per-source rows whose RRULE matches that slot.
   */
  titleTemplate?: string;
  /**
   * Cap on the forward window (days from "now") used when expanding RRULE /
   * lunar rules. Mirrors GOOGLE_CALENDAR's `futureHorizonDays` — same key
   * name, same units, same default. Bounds how far an unbounded recurrence
   * (no UNTIL / no COUNT) can materialize when an audit-driven wide-window
   * scrape (e.g. `options.days = 1500`) reaches the adapter. The historical
   * back-window is unaffected so deep backfills still work. Closes #1419.
   */
  futureHorizonDays?: number;
}

/**
 * Default forward-horizon cap for RRULE / lunar expansion. Matches GOOGLE_CALENDAR's
 * `DEFAULT_FUTURE_HORIZON_DAYS` so admins can reason about both adapters with one
 * mental model. See header comment in `prisma/seed-data/sources.ts` for the policy
 * (#1419) and the per-source override pattern.
 */
export const DEFAULT_FUTURE_HORIZON_DAYS = 365;

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
  let dates: string[] = [];
  if (rule.freq === "WEEKLY" && rule.byDay) {
    dates = generateWeeklyDates(rule.byDay.day, rule.interval, windowStart, windowEnd, anchorDate);
  } else if (rule.freq === "MONTHLY") {
    if (rule.byDay?.nth !== undefined) {
      dates = generateMonthlyNthWeekdayDates(rule.byDay.day, rule.byDay.nth, rule.interval, windowStart, windowEnd);
    } else if (rule.byMonthDay) {
      dates = generateMonthlyByMonthDayDates(rule.byMonthDay, rule.interval, windowStart, windowEnd);
    } else if (rule.byDay) {
      dates = generateMonthlyByWeekdayDates(rule.byDay.day, rule.interval, windowStart, windowEnd);
    }
  }

  if (rule.byMonth && rule.byMonth.length > 0) {
    const allowed = new Set(rule.byMonth);
    // YYYY-MM-DD → month is chars 5-6 (1-indexed slice), parse as 1-12.
    dates = dates.filter((d) => allowed.has(Number.parseInt(d.slice(5, 7), 10)));
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

/**
 * Check whether [windowStart, windowEnd] overlaps any (year, month) pair whose
 * 1-indexed month is in `months`. Used to distinguish a seasonal rule's
 * legitimate off-season (no overlap) from an actual misconfiguration (overlap
 * but still no occurrences).
 */
function windowOverlapsAnyMonth(windowStart: Date, windowEnd: Date, months: number[]): boolean {
  const allowed = new Set(months);
  let year = windowStart.getUTCFullYear();
  let month = windowStart.getUTCMonth(); // 0-indexed
  const endYear = windowEnd.getUTCFullYear();
  const endMonth = windowEnd.getUTCMonth();
  while (year < endYear || (year === endYear && month <= endMonth)) {
    if (allowed.has(month + 1)) return true;
    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
  }
  return false;
}

/** Format a UTC date as YYYY-MM-DD. */
function formatDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Compute a run number for a generated WEEKLY occurrence from a known anchor.
 * `intervalDays` is the rule's `interval * 7` step, so `(date - anchor)` is an
 * exact integer multiple — `Math.round` is unambiguous and immune to any
 * sub-day drift. The occurrence parses at UTC noon (matching
 * `generateWeeklyDates`); the anchor is pre-parsed to ms by the caller so it's
 * computed once per scrape rather than once per occurrence.
 *
 * Used only when `startRunNumber` + `anchorDate` are configured on a WEEKLY
 * rule; see `StaticScheduleConfig.startRunNumber`.
 */
export function computeRunNumber(
  dateStr: string,
  anchorMs: number,
  startRunNumber: number,
  intervalDays: number,
): number {
  const dateMs = new Date(dateStr + "T12:00:00Z").getTime();
  return startRunNumber + Math.round((dateMs - anchorMs) / (intervalDays * 86_400_000));
}

/**
 * Validate a time string is in strict HH:MM 24-hour format.
 * Returns the time string if valid, undefined otherwise.
 */
function normalizeTime(raw: string): string | undefined {
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  return undefined;
}

const DAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTH_NAMES_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * Render a title template with date-derived tokens. Tokens not in the supported
 * set are left literal so typos like `{Date}` (capital D) surface visibly in the
 * UI rather than silently rendering empty. Only date-derived tokens are
 * supported — schedule-semantic tokens (nth-of-month etc.) would lie about
 * weekly rules, so admins encode that intent as literal text per source row.
 *
 * @param template - e.g. `"DST — {date} Hash"`
 * @param dateStr  - YYYY-MM-DD (interpreted as UTC noon)
 */
export function renderTitleTemplate(template: string, dateStr: string): string {
  const dt = new Date(dateStr + "T12:00:00Z");
  if (Number.isNaN(dt.getTime())) return template;
  const dayName = DAY_NAMES_FULL[dt.getUTCDay()];
  const monthName = MONTH_NAMES_FULL[dt.getUTCMonth()];
  const dayNum = dt.getUTCDate();
  const tokens: Record<string, string> = {
    "{dayName}": dayName,
    "{monthName}": monthName,
    "{date}": `${monthName} ${dayNum}`,
    "{iso}": dateStr,
  };
  return template.replaceAll(/\{[A-Za-z]+\}/g, (match) => tokens[match] ?? match);
}

/**
 * Adapter for kennels that operate on a consistent, predictable schedule but lack
 * a scrapeable website (e.g., Facebook-only groups). Generates recurring events
 * purely from config — no network I/O.
 */
export class StaticScheduleAdapter implements SourceAdapter {
  type = "STATIC_SCHEDULE" as const;

  /**
   * Generate recurring events from the source's RRULE schedule config. Default
   * window is ±90 days; the forward side is capped at `futureHorizonDays` so a
   * wide-window backfill can't materialize years of placeholder events.
   */
  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const configResult = parseAdapterConfig(source);
    if (!configResult.ok) return errorResult(configResult.error);

    const { config, validated } = configResult;
    const requestedDays = options?.days ?? 90;
    const forwardDays = Math.min(requestedDays, resolveFutureHorizonDays(config.futureHorizonDays));
    const window = computeScrapeWindow(requestedDays, forwardDays);

    const occurrencesResult =
      validated.kind === "lunar"
        ? computeLunarOccurrences(validated.lunar, window)
        : computeRruleOccurrences(validated.rrule, config.anchorDate, window);
    if (occurrencesResult.kind === "error") return errorResult(occurrencesResult.message);
    if (occurrencesResult.kind === "off-season") {
      return {
        events: [],
        errors: [],
        diagnosticContext: {
          ...occurrencesResult.diagnostic,
          occurrencesGenerated: 0,
          windowDays: window.days,
          forwardWindowDays: window.forwardDays,
          windowStart: window.start.toISOString(),
          windowEnd: window.end.toISOString(),
          note: "off-season: window does not overlap any BYMONTH month",
        },
      };
    }

    const { occurrences, diagnostic } = occurrencesResult;
    const startTime = config.startTime ? normalizeTime(config.startTime) : undefined;

    // titleTemplate is opt-in; we accept only strings here so a malformed admin
    // payload (e.g. `titleTemplate: []`) fails closed to defaultTitle instead of
    // crashing the scrape inside renderTitleTemplate(). Whitespace-only strings
    // are treated as absent so a field cleared in the admin panel doesn't render
    // empty titles on every event.
    const rawTpl = config.titleTemplate;
    const titleTemplate =
      typeof rawTpl === "string" && rawTpl.trim().length > 0 ? rawTpl : undefined;

    // Run-number computation is opt-in (`startRunNumber` + `anchorDate`) and
    // WEEKLY-only — a fixed `interval * 7`-day step is what makes each
    // occurrence an exact number of runs from the anchor. MONTHLY / lunar rules
    // (no `rule` here, or non-WEEKLY freq) emit no run number, unchanged.
    const rule = occurrencesResult.rule;
    const startRunNumber = config.startRunNumber;
    const computeRuns =
      rule?.freq === "WEEKLY" &&
      typeof config.anchorDate === "string" &&
      typeof startRunNumber === "number" &&
      Number.isInteger(startRunNumber) &&
      startRunNumber > 0;
    // Anchor and interval are fixed for the whole batch — parse once here rather
    // than per occurrence inside the map. A format-valid but semantically-invalid
    // anchorDate (e.g. "2019-13-99", which passes the admin YYYY-MM-DD check but
    // is not a real date) parses to NaN. For WEEKLY INTERVAL=1 rules the date
    // generator ignores anchorDate entirely, so occurrences still emit — guard
    // here so a NaN anchor never yields a `runNumber: NaN` written to the DB
    // (fail safe to the no-run-number default rather than silent corruption).
    const anchorMs = computeRuns ? new Date((config.anchorDate as string) + "T12:00:00Z").getTime() : 0;
    const intervalDays = computeRuns ? (rule as ParsedRRule).interval * 7 : 0;
    const emitRunNumbers = computeRuns && Number.isFinite(anchorMs);

    const events: RawEventData[] = occurrences.map((date) => ({
      date,
      kennelTags: [config.kennelTag],
      title: titleTemplate ? renderTitleTemplate(titleTemplate, date) : config.defaultTitle,
      description: config.defaultDescription,
      location: config.defaultLocation,
      startTime,
      sourceUrl: source.url,
      ...(emitRunNumbers
        ? { runNumber: computeRunNumber(date, anchorMs, startRunNumber as number, intervalDays) }
        : {}),
    }));

    return {
      events,
      errors: [],
      diagnosticContext: {
        ...diagnostic,
        occurrencesGenerated: events.length,
        windowDays: window.days,
        forwardWindowDays: window.forwardDays,
        windowStart: window.start.toISOString(),
        windowEnd: window.end.toISOString(),
      },
    };
  }
}

/** Helper: package a fetch error as the standard `ScrapeResult` shape. */
function errorResult(message: string): ScrapeResult {
  return { events: [], errors: [message], errorDetails: { fetch: [{ message }] } };
}

interface ScrapeWindow {
  start: Date;
  end: Date;
  /** Days of historical back-window — the original `options.days` value. */
  days: number;
  /** Days of forward projection — `min(options.days, futureHorizonDays)`. */
  forwardDays: number;
}

/**
 * Compute an asymmetric scrape window centered on UTC noon today: `days` back,
 * `forwardDays` forward. Deep backfills set `days` large; the forward cap
 * (#1419, #1673) keeps an unbounded RRULE from materializing years of
 * placeholder events.
 */
function computeScrapeWindow(days: number, forwardDays: number): ScrapeWindow {
  const now = new Date();
  const todayNoon = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0);
  return {
    start: new Date(todayNoon - days * 86_400_000),
    end: new Date(todayNoon + forwardDays * 86_400_000),
    days,
    forwardDays,
  };
}

/**
 * Defensive parse for `config.futureHorizonDays` — non-numeric, NaN, ±Infinity,
 * negative, or zero falls back to the default. NaN would otherwise propagate
 * into Date arithmetic and silently emit zero events. Mirrors the same guard
 * inlined in the GOOGLE_CALENDAR adapter so policy stays uniform.
 */
function resolveFutureHorizonDays(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? raw
    : DEFAULT_FUTURE_HORIZON_DAYS;
}

type ConfigParseResult =
  | { ok: true; config: StaticScheduleConfig; validated: Extract<ValidatedSchedule, { ok: true }> }
  | { ok: false; error: string };

/** Validate source.config shape + XOR contract. Pulls the success/error
 *  branching out of fetch() so the main flow stays linear. */
function parseAdapterConfig(source: Source): ConfigParseResult {
  let config: StaticScheduleConfig;
  try {
    config = validateSourceConfig<StaticScheduleConfig>(
      source.config,
      "StaticScheduleAdapter",
      { kennelTag: "string" },
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid source config" };
  }
  const validated = validateRruleLunarXor(config);
  if (!validated.ok) return { ok: false, error: validated.error };
  return { ok: true, config, validated };
}

type OccurrencesResult =
  | { kind: "ok"; occurrences: string[]; diagnostic: DiagnosticRule; rule?: ParsedRRule }
  | { kind: "off-season"; diagnostic: DiagnosticRule }
  | { kind: "error"; message: string };

/** Lunar branch: generate occurrences and the lunar diagnostic shape. */
function computeLunarOccurrences(
  lunar: LunarConfig,
  window: ScrapeWindow,
): OccurrencesResult {
  const occurrences = generateLunarOccurrences(lunar, window.start, window.end);
  const diagnostic: DiagnosticRule = {
    mode: "lunar",
    phase: lunar.phase,
    timezone: lunar.timezone,
    anchorWeekday: lunar.anchorWeekday ?? null,
    anchorRule: lunar.anchorRule ?? null,
  };
  if (occurrences.length === 0) {
    return {
      kind: "error",
      message: `Lunar config (${lunar.phase}) generated 0 events in ${window.days}-day window — check timezone and window`,
    };
  }
  return { kind: "ok", occurrences, diagnostic };
}

/** RRULE branch: parse + generate + classify zero-output as off-season vs misconfiguration. */
function computeRruleOccurrences(
  rruleStr: string,
  anchorDate: string | undefined,
  window: ScrapeWindow,
): OccurrencesResult {
  let rule: ReturnType<typeof parseRRule>;
  try {
    rule = parseRRule(rruleStr);
  } catch (err) {
    return {
      kind: "error",
      message: `Invalid RRULE "${rruleStr}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const occurrences = generateOccurrences(rule, window.start, window.end, anchorDate);
  const diagnostic: DiagnosticRule = { mode: "rrule", rrule: rruleStr };
  if (occurrences.length > 0) return { kind: "ok", occurrences, diagnostic, rule };

  // Off-season for a seasonal rule is expected, not a misconfiguration.
  const seasonalOffSeason =
    rule.byMonth !== undefined && rule.byMonth.length > 0 &&
    !windowOverlapsAnyMonth(window.start, window.end, rule.byMonth);
  if (seasonalOffSeason) return { kind: "off-season", diagnostic };
  return {
    kind: "error",
    message: `RRULE "${rruleStr}" generated 0 events in ${window.days}-day window — check schedule configuration`,
  };
}

/** Diagnostic-context shape per branch — surfaces in scrape logs and self-healing alerts. */
type DiagnosticRule =
  | { mode: "lunar"; phase: LunarConfig["phase"]; timezone: string; anchorWeekday: LunarConfig["anchorWeekday"] | null; anchorRule: LunarConfig["anchorRule"] | null }
  | { mode: "rrule"; rrule: string };

type ValidatedSchedule =
  | { ok: true; kind: "rrule"; rrule: string }
  | { ok: true; kind: "lunar"; lunar: LunarConfig }
  | { ok: false; error: string };

/**
 * Lunar-specific validation. Extracted from `validateRruleLunarXor` so each
 * function stays under SonarCloud's cognitive-complexity cap. Mirrors the
 * admin-side `validateLunarConfig` in `config-validation.ts`. Returns the
 * first error encountered, or `null` for a valid block.
 */
function validateLunarBlock(lunar: LunarConfig): string | null {
  if (lunar.phase !== "full" && lunar.phase !== "new") {
    return `lunar.phase must be "full" or "new", got ${JSON.stringify(lunar.phase)}`;
  }
  if (typeof lunar.timezone !== "string" || lunar.timezone.trim().length === 0) {
    return 'lunar.timezone is required (IANA timezone string, e.g. "America/Los_Angeles")';
  }
  // Codex pass-3: invalid IANA tz was silently remapped to UTC by the formatter,
  // generating events on the wrong calendar day. Reject up front.
  if (!isValidTimezone(lunar.timezone)) {
    return `lunar.timezone "${lunar.timezone}" is not a recognized IANA timezone`;
  }
  const hasWeekday = lunar.anchorWeekday !== undefined && lunar.anchorWeekday !== null;
  const hasRule = lunar.anchorRule !== undefined && lunar.anchorRule !== null;
  if (hasWeekday !== hasRule) {
    return "lunar.anchorWeekday and lunar.anchorRule must be set together (or both omitted)";
  }
  // Codex pass-3: persisted JSON can carry arbitrary strings; without enum
  // check, snapToAnchorWeekday reads WEEKDAY_NAMES[bogus] as undefined and
  // produces NaN dates that crash toIsoDateString.
  if (hasWeekday && !ANCHOR_WEEKDAYS.includes(lunar.anchorWeekday as (typeof ANCHOR_WEEKDAYS)[number])) {
    return `lunar.anchorWeekday "${lunar.anchorWeekday}" must be one of ${ANCHOR_WEEKDAYS.join(", ")}`;
  }
  if (hasRule && !ANCHOR_RULES.includes(lunar.anchorRule as (typeof ANCHOR_RULES)[number])) {
    return `lunar.anchorRule "${lunar.anchorRule}" must be one of ${ANCHOR_RULES.join(", ")}`;
  }
  return null;
}

/**
 * Enforce that exactly one of rrule | lunar is set, and that the chosen branch
 * has its required fields. The discriminated return lets the caller branch
 * on `kind` without non-null assertions on the original config. Mirrored by
 * `validateStaticScheduleConfig` in the admin wizard so the same rule applies
 * in both cron and admin contexts.
 */
function validateRruleLunarXor(config: StaticScheduleConfig): ValidatedSchedule {
  const rrule = typeof config.rrule === "string" ? config.rrule.trim() : "";
  const hasRrule = rrule.length > 0;
  const hasLunar = config.lunar !== undefined && config.lunar !== null;
  if (!hasRrule && !hasLunar) {
    return { ok: false, error: "StaticScheduleAdapter: config must specify either rrule or lunar" };
  }
  if (hasRrule && hasLunar) {
    return { ok: false, error: "StaticScheduleAdapter: config cannot specify both rrule and lunar (XOR)" };
  }
  if (hasRrule) return { ok: true, kind: "rrule", rrule };
  const lunar = config.lunar as LunarConfig;
  const lunarError = validateLunarBlock(lunar);
  if (lunarError) return { ok: false, error: `StaticScheduleAdapter: ${lunarError}` };
  return { ok: true, kind: "lunar", lunar };
}
