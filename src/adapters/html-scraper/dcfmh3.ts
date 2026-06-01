import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { applyDateWindow, chronoParseDate, fetchHTMLPage, stripHtmlTags } from "../utils";

/**
 * DC Full Moon Hash House Harriers (DCFMH3) Google Sites adapter.
 *
 * sites.google.com/site/dcfmh3/home/dc-kennel-calendar publishes a hand-maintained
 * annual schedule where each monthly full-moon trail carries a distinct moon name
 * AND a rotating host kennel — DCFMH3 is an umbrella that doesn't run its own
 * trails; a different DC-area kennel hosts each month. Each entry is one
 * `<p><span>` line, e.g.:
 *
 *   July 31, 2026: Full Buck Moon - DCH3
 *   February 6, 2026: Full Snow Moon - EWH3 Hash Olympdicks Trail
 *   January 3, 2026: Smutty Crab H3            (no moon name — host is the title)
 *   March 6 - Worm Blood Moon                  (dash separator, no year)
 *   June 6-14: ¡Tour Duh Hash!                 (date range — emit on start date)
 *
 * Replaces the former STATIC_SCHEDULE (lunar) source, which could only synthesize
 * a generic placeholder title ("DCFMH3 Full Moon Run") and drifted 1–3 days off
 * the published dates (#1399). Parsing the published schedule fixes both the
 * titles and the dates, and surfaces the host kennel:
 *   - #1399: title = the verbatim source text (moon name + host).
 *   - #1400: when the host matches a seeded kennel, it is emitted as a secondary
 *     co-host tag → merge writes an EventKennel co-host (#1023). Unseeded hosts
 *     (Smutty Crab, White House, etc.) stay in the title only — no sourceless
 *     kennel rows are created.
 */

interface DCFMH3Config {
  kennelTag?: string; // primary kennel; defaults to "dcfmh3"
  startTime?: string; // "HH:MM"; defaults to "18:30"
  defaultLocation?: string;
  defaultDescription?: string;
}

const MONTH_NAMES = new Set([
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
]);

/**
 * One schedule line: `<Month> <Day>[-<Day2>][, <Year>] <sep> <title>` where the
 * first `:` or ` - ` after the date opens the title. The optional `-<Day2>` range
 * end is captured so a multi-day entry (`June 6-14: ¡Tour Duh Hash!`) emits a
 * single Event with `endDate` set (a campout — NOT a per-day series split).
 * Groups: 1=monthWord, 2=startDay, 3=endDay?, 4=year?, 5=title.
 *
 * The leading word is matched generically (`[A-Za-z]+`) and validated against
 * MONTH_NAMES in code — keeping the regex a literal (no `new RegExp` →
 * Codacy/Semgrep detect-non-literal-regexp) while avoiding a 12-branch month
 * alternation that would blow Sonar's regex-complexity cap (S5843).
 */
const SCHEDULE_LINE_RE =
  /^([A-Za-z]+)\s+(\d{1,2})(?:\s*-\s*(\d{1,2}))?(?:,?\s*(\d{4}))?\s*[:–-]\s*(\S.*)$/i;

/**
 * Host kennel detection (#1400). Only seeded DC-area kennels are listed; the
 * matched kennelCode becomes a secondary co-host tag. Keep in sync with the
 * DCFMH3 source's `kennelCodes` in prisma/seed-data/sources.ts (the merge
 * source-kennel guard blocks tags the source isn't linked to). `\b…\b` boundaries
 * keep DCH3 from matching DCH4 / DCFMH3.
 */
const HOST_KENNEL_PATTERNS: readonly [RegExp, string][] = [
  [/\bEWH3\b/i, "ewh3"],
  [/\bDCH4\b/i, "dch4"],
  [/\bDCH3\b/i, "dch3"],
  [/\bCharm City\b/i, "cch3"],
  [/\bMount Vernon\b/i, "mvh3"],
  [/\bFredericksburg Urban\b/i, "fuh3"],
  [/\bHangover\b/i, "h4"],
];

/** Resolve a seeded host kennelCode from the event title, or undefined. */
export function detectHostKennel(title: string): string | undefined {
  for (const [re, code] of HOST_KENNEL_PATTERNS) {
    if (re.test(title)) return code;
  }
  return undefined;
}

export interface ParsedScheduleEntry {
  date: string; // YYYY-MM-DD (start)
  endDate?: string; // YYYY-MM-DD, set only for multi-day ranges (campouts)
  title: string;
  hostKennelCode?: string;
}

/**
 * Flatten the Google Sites HTML into one line per schedule paragraph, then parse
 * each `<date>: <title>` entry. `fallbackYear` fills year-less rows ("March 6").
 */
export function parseDCFMH3Schedule(
  html: string,
  fallbackYear: number,
): ParsedScheduleEntry[] {
  // stripHtmlTags flattens each <p>/block to its own line, removes script/style,
  // decodes entities, and collapses internal whitespace — one schedule entry per
  // line, exactly what the per-line regex below needs. Non-schedule lines
  // (headings, nav, the <title>) simply don't match SCHEDULE_LINE_RE.
  const text = stripHtmlTags(html, "\n");

  const seen = new Set<string>();
  const entries: ParsedScheduleEntry[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const m = SCHEDULE_LINE_RE.exec(line);
    if (!m) continue;
    const [, month, startDay, endDay, year, rawTitle] = m;
    // The regex matches any leading word; only real month names are schedule rows.
    if (!MONTH_NAMES.has(month.toLowerCase())) continue;
    const title = rawTitle.trim();
    if (!title) continue;
    const yr = year ?? fallbackYear;
    const date = chronoParseDate(`${month} ${startDay}, ${yr}`, "en-US");
    if (!date) continue;
    // Multi-day range ("June 6-14") → single Event spanning to endDate (campout),
    // not a per-day series. Only when the end day is later in the same month.
    let endDate: string | undefined;
    if (endDay && Number.parseInt(endDay, 10) > Number.parseInt(startDay, 10)) {
      endDate = chronoParseDate(`${month} ${endDay}, ${yr}`, "en-US") ?? undefined;
    }
    // Dedup repeated lines (the page echoes a "next trail" banner up top).
    const key = `${date}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ date, endDate, title, hostKennelCode: detectHostKennel(title) });
  }
  return entries;
}

/** Pick the year that appears in most dated lines, for year-less rows. */
function inferScheduleYear(html: string): number {
  const years = [...html.matchAll(/\b(20\d{2})\b/g)].map((m) => Number.parseInt(m[1], 10));
  if (years.length === 0) return new Date().getUTCFullYear();
  const counts = new Map<number, number>();
  for (const y of years) counts.set(y, (counts.get(y) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export class DCFMH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || "https://sites.google.com/site/dcfmh3/home/dc-kennel-calendar";
    const config = (source.config ?? {}) as DCFMH3Config;
    const kennelTag = config.kennelTag ?? "dcfmh3";
    const startTime = config.startTime ?? "18:30";

    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;
    const { html, structureHash, fetchDurationMs } = page;

    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const fallbackYear = inferScheduleYear(html);
    const entries = parseDCFMH3Schedule(html, fallbackYear);

    const events: RawEventData[] = entries.map((e) => ({
      date: e.date,
      ...(e.endDate ? { endDate: e.endDate } : {}),
      // #1400: host kennel (when seeded) rides as a secondary co-host tag.
      kennelTags: e.hostKennelCode ? [kennelTag, e.hostKennelCode] : [kennelTag],
      title: e.title,
      startTime,
      location: config.defaultLocation,
      description: config.defaultDescription,
      sourceUrl: url,
    }));

    if (events.length === 0) {
      errors.push("DCFMH3: zero schedule entries parsed from Google Sites calendar");
      errorDetails.parse = [
        { row: 0, section: "calendar", error: "No <date>: <title> lines matched", rawText: html.slice(0, 500) },
      ];
    }

    const days = options?.days ?? source.scrapeDays ?? 365;
    return applyDateWindow(
      {
        events,
        errors,
        structureHash,
        errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
        diagnosticContext: {
          url,
          fetchMethod: "fetchHTMLPage",
          entriesParsed: entries.length,
          eventsWithHost: entries.filter((e) => e.hostKennelCode).length,
          fallbackYear,
          fetchDurationMs,
        },
      },
      days,
    );
  }
}
