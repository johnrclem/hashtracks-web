import { createHash } from "node:crypto";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { fetchWordPressComPage } from "../wordpress-api";
import { MONTHS, decodeEntities, buildDateWindow, stripHtmlTags } from "../utils";
import { todayInTimezone } from "@/lib/timezone";

const DEFAULT_SITE_DOMAIN = "hashhousehorrors.com";
const HARELINE_ARCHIVE_SLUG = "hareline";
const HARELINE_UPCOMING_SLUG = "hareline-2";
const KENNEL_TAG = "hhhorrors";
const DEFAULT_START_TIME = "16:30";
// Hash House Horrors runs in Singapore (UTC+8). The /hareline-2/ upcoming
// page has no year heading, so we default to the kennel's local year — using
// UTC would mis-date the first ~8 hours of January 1 every year.
const KENNEL_TIMEZONE = "Asia/Singapore";

/**
 * Hash House Horrors (Singapore) adapter.
 *
 * The kennel publishes runs across two WordPress.com hosted pages:
 *   - `/hareline`     → the year-grouped historical archive (1993 → present).
 *                       Most-recent past runs are at the top, oldest at the bottom.
 *   - `/hareline-2/`  → the small "upcoming" list (typically 4-6 future runs).
 *                       No year heading; the current calendar year is implied,
 *                       with auto-rollover when the date sequence wraps.
 *
 * Both pages share the same per-row format:
 *   `<runNumber> – <month> <day> – <hares>[ – <location>]`
 *
 * Quirks we handle here (see #1253):
 *   - "BREAK" notices (`<p>NNNN – Mon D – Hash Committee</p><p>BREAK</p>`)
 *     are informational no-run markers and emit no event.
 *   - "*Hares Needed*" / "***Hares Needed***" — the kennel sometimes wraps
 *     the sentinel in asterisks; we strip them before the sentinel check.
 *
 * Children's hash, biweekly Sundays starting 4:30 PM.
 */

// Each run line begins with the run number followed by a separator (en-dash,
// em-dash, ASCII hyphen, or colon — older archive entries use ":"). The body
// after the separator carries the month/day in either "Month D" (post-2019)
// or "D Month" order (2018-2019 hareline rewrite). Optional decorations
// (ordinal suffixes, inline year, parenthetical themed-run annotation) and
// the tail (hares ± location) are stripped procedurally rather than via one
// catastrophic-backtracking regex — Sonar S5852 flags any `\s*` adjacent to
// optional alternation, so the linear shape below avoids the analyzer
// hotspot without sacrificing coverage. See burlington-hash.ts for the same
// pattern.
const RUN_PREFIX_RE = /^(\d{3,4})\s*[–—:-]\s*/i;
// Day in "Month D" order is captured *before* the optional ordinal so
// `afterHead` can strip "rd" / "th" procedurally. In "D Month" order the
// ordinal sits between digit and month, so it has to be in the head regex
// (e.g. "9th April"). Both heads are linear — no `\s*`-adjacent alternation
// that would trip Sonar S5852.
const MONTH_DAY_HEAD = /^([a-z]+)\s+(\d{1,2})/i;
const DAY_MONTH_HEAD = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)/i;
const ORDINAL_SUFFIX_RE = /^(?:st|nd|rd|th)\b/i;
const INLINE_YEAR_RE = /^(?:19|20)\d{2}\b/;
const PAREN_THEME_RE = /^\(([^)]*)\)/;
const TAIL_DASH_RE = /^[–—-]\s*(.+)$/;

interface ParsedRunLine {
  runNumber: number;
  monthIdx: number;
  day: number;
  /** Theme annotation from parentheses after the day (e.g. "Christmas Hash"). */
  theme?: string;
  hares?: string;
  location?: string;
  /** Source emitted an informational no-run marker (e.g. BREAK) — emit no event. */
  isBreak?: true;
}

/** Strip leading and trailing asterisks (and any whitespace they wrap) from
 *  a string. Procedural rather than regex-based so we don't trip Sonar S5852
 *  on the `\s*`-adjacent-to-alternation pattern. */
function stripWrappingAsterisks(value: string): string {
  let s = value;
  while (s.startsWith("*")) s = s.slice(1);
  s = s.trimStart();
  while (s.endsWith("*")) s = s.slice(0, -1);
  return s.trimEnd();
}

/** Consume any optional ordinal/year/whitespace/parenthetical theme prefix
 *  from `remainder`, returning what's left plus an extracted theme (if any). */
function stripDecorations(remainder: string): { rest: string; theme: string | undefined } {
  let rest = remainder.trimStart();
  rest = rest.replace(ORDINAL_SUFFIX_RE, "").trimStart();
  rest = rest.replace(INLINE_YEAR_RE, "").trimStart();
  const paren = PAREN_THEME_RE.exec(rest);
  let theme: string | undefined;
  if (paren) {
    theme = paren[1].trim() || undefined;
    rest = rest.slice(paren[0].length).trimStart();
  }
  return { rest, theme };
}

/** Parse a single line like "1016 – May 17 – Wade Family – Pearl Hill". */
export function parseHashHorrorsRunLine(line: string): ParsedRunLine | null {
  const cleaned = line.trim();
  const prefix = RUN_PREFIX_RE.exec(cleaned);
  if (!prefix) return null;
  const runNumber = Number.parseInt(prefix[1], 10);
  const body = cleaned.slice(prefix[0].length);

  // Try "Month D" first (post-2019 format), fall back to "D Month" used by
  // the 2018-2019 hareline rewrite. Whichever head matches gives us month +
  // day; remaining decorations (ordinal/year/paren-theme) and the tail get
  // stripped procedurally below so the regex pieces stay linear (Sonar S5852).
  let monthStr: string;
  let dayStr: string;
  let afterHead: string;
  const md = MONTH_DAY_HEAD.exec(body);
  if (md) {
    monthStr = md[1];
    dayStr = md[2];
    afterHead = body.slice(md[0].length);
  } else {
    const dm = DAY_MONTH_HEAD.exec(body);
    if (!dm) return null;
    dayStr = dm[1];
    monthStr = dm[2];
    afterHead = body.slice(dm[0].length);
  }

  const monthIdx = MONTHS[monthStr.toLowerCase()];
  if (!monthIdx) return null;
  const day = Number.parseInt(dayStr, 10);
  if (day < 1 || day > 31) return null;

  const { rest, theme } = stripDecorations(afterHead);
  const tailMatch = TAIL_DASH_RE.exec(rest);
  const tail = tailMatch?.[1]?.trim() || undefined;

  let hares: string | undefined;
  let location: string | undefined;
  if (tail) {
    // Split on any dash variant (en/em/hyphen) surrounded by spaces. The last
    // match separates hares from location; earlier dashes are part of a
    // multi-family hare list.
    const dashRe = /\s+[–—-]\s+/g;
    let lastIdx = -1;
    let lastLen = 0;
    for (const dm of tail.matchAll(dashRe)) {
      lastIdx = dm.index ?? -1;
      lastLen = dm[0].length;
    }
    if (lastIdx > 0) {
      hares = tail.slice(0, lastIdx).trim();
      location = tail.slice(lastIdx + lastLen).trim();
    } else {
      hares = tail;
    }
  }

  // BREAK detection — kennel publishes the marker in a separate <p> from the
  // run line; after HTML strip + whitespace collapse it tails the hares field
  // ("Hash Committee BREAK"). Treat the whole row as an informational marker,
  // not a parse failure (don't increment skippedLines or surface to alerts).
  if (hares && /\bBREAK\s*$/i.test(hares)) {
    return { runNumber, monthIdx, day, theme, isBreak: true };
  }

  // "Hares Needed" sentinel — drop the value. Strip wrapping asterisks first
  // (the kennel sometimes writes it as "*Hares Needed*" or "***Hares Needed***").
  // Procedural strip avoids Sonar S5852 on the `\s*`-adjacent-to-alternation
  // shape the regex form trips.
  if (hares) {
    const unstarred = stripWrappingAsterisks(hares);
    if (/^Hares\s+Needed$/i.test(unstarred)) hares = undefined;
  }

  return { runNumber, monthIdx, day, theme, hares, location };
}

export interface ParseHarelineResult {
  events: RawEventData[];
  /** Run lines that matched the run-start tokenizer but failed the line parser. */
  skippedLines: number;
  /** Run lines that were recognised but intentionally emit no event (e.g. BREAK). */
  skippedMarkers: number;
}

/**
 * Find year-heading positions in the archive text.
 *
 * After HTML strip + whitespace collapse, real year headings appear as a
 * standalone 4-digit number immediately followed by the next run line
 * ("…2017 871 – December 17th – Coke Family…"), whereas inline year usages
 * inside a row ("April 23rd 2017 – The Mitchell Family") never have a run
 * number right after the year. Anchoring on the following run number filters
 * out the inline year noise that previously chopped the 2017 archive section
 * into 14 unparseable fragments. The followed-by-token can be a month name
 * (post-2019 layout) or a day number (2018-2019 layout).
 */
function findYearHeadings(text: string): Array<{ year: number; start: number; end: number }> {
  const headings: Array<{ year: number; start: number; end: number }> = [];
  for (const m of text.matchAll(/\b((?:19|20)\d{2})\s+\d{3,4}\s*[–—:-]\s*(?:[a-z]+|\d{1,2})/gi)) {
    const start = m.index ?? 0;
    headings.push({ year: Number.parseInt(m[1], 10), start, end: start + m[1].length });
  }
  return headings;
}

/**
 * Find run-line start positions within a year section. Each candidate match
 * begins with the run number and the field separator (dash or colon). The
 * follow-up token can be a month name (post-2019 layout) or a day number
 * (2018-2019 layout). Year-shaped numbers (1900-2099) are filtered out to
 * prevent inline year tokens from being treated as run-number prefixes when
 * the surrounding row is "23rd 2017 – The Mitchell Family"-style.
 *
 * LIMIT: at ~26 runs/year, the kennel reaches run #1900 around 2060 (~34
 * years out). When run numbers approach 1900, replace this numeric filter
 * with a context-aware check (e.g. look backwards from the candidate for an
 * ordinal/space pattern) or shift to a per-row tokenizer. Codex flagged
 * this on PR #1536 as a long-horizon correctness regression.
 */
function findRunLineStarts(section: string): number[] {
  const starts: number[] = [];
  for (const m of section.matchAll(/(\d{3,4})\s*[–—:-]\s*(?:[a-z]+|\d{1,2})/gi)) {
    const n = Number.parseInt(m[1], 10);
    if (n >= 1900 && n <= 2099) continue;
    if (m.index !== undefined) starts.push(m.index);
  }
  return starts;
}

function buildEvent(parsed: ParsedRunLine, year: number): RawEventData {
  const date = `${year}-${String(parsed.monthIdx).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`;
  const baseTitle = `Hash Horrors ${parsed.runNumber}`;
  const title = parsed.theme ? `${baseTitle} — ${parsed.theme}` : baseTitle;
  return {
    date,
    startTime: DEFAULT_START_TIME,
    kennelTags: [KENNEL_TAG],
    runNumber: parsed.runNumber,
    title,
    hares: parsed.hares,
    location: parsed.location,
  };
}

/**
 * Walk a run-line region of text. The `yearForLine` callback owns year
 * selection: the archive page returns a section's fixed year heading, the
 * upcoming page maintains a rolling year that bumps when the calendar wraps.
 * Skip markers (BREAK rows) are still passed to the callback so the
 * upcoming-page rollover detector stays in sync across no-event rows.
 */
function walkRunLines(
  text: string,
  yearForLine: (parsed: ParsedRunLine) => number,
): ParseHarelineResult {
  const events: RawEventData[] = [];
  let skippedLines = 0;
  let skippedMarkers = 0;
  const starts = findRunLineStarts(text);
  for (let i = 0; i < starts.length; i++) {
    const lineEnd = starts[i + 1] ?? text.length;
    const line = text.slice(starts[i], lineEnd).trim();
    const parsed = parseHashHorrorsRunLine(line);
    if (!parsed) {
      skippedLines++;
      continue;
    }
    const year = yearForLine(parsed);
    if (parsed.isBreak) {
      skippedMarkers++;
      continue;
    }
    events.push(buildEvent(parsed, year));
  }
  return { events, skippedLines, skippedMarkers };
}

/**
 * Walk the year-grouped archive page. Each `2026` / `2025` / etc. heading
 * acts as the active year for the run lines that follow until the next.
 */
export function parseHashHorrorsHareline(text: string): ParseHarelineResult {
  const events: RawEventData[] = [];
  let skippedLines = 0;
  let skippedMarkers = 0;
  const headings = findYearHeadings(text);
  for (let i = 0; i < headings.length; i++) {
    const { year, end } = headings[i];
    const sectionEnd = headings[i + 1]?.start ?? text.length;
    const section = text.slice(end, sectionEnd);
    const sectionResult = walkRunLines(section, () => year);
    events.push(...sectionResult.events);
    skippedLines += sectionResult.skippedLines;
    skippedMarkers += sectionResult.skippedMarkers;
  }
  return { events, skippedLines, skippedMarkers };
}

/**
 * Walk the `/hareline-2/` upcoming page. There is no year heading — the
 * implied year is `currentYear`, advancing by one whenever the calendar
 * date wraps backwards (e.g. Dec → Jan crossing).
 *
 * `currentMonth` (1-12) seeds the year for the FIRST run on the page. When
 * the upcoming list begins in a month earlier than today's month, those
 * runs belong to next year (e.g. a Dec-15 scrape sees a Jan-3 run as 2027,
 * not 2026). Without this seed, January-only upcoming pages would be
 * mis-dated for the last ~6 weeks of every year.
 */
export function parseHashHorrorsUpcoming(
  text: string,
  currentYear: number,
  currentMonth: number,
): ParseHarelineResult {
  let year = currentYear;
  let prev: { month: number; day: number } | null = null;
  return walkRunLines(text, (parsed) => {
    const cur = { month: parsed.monthIdx, day: parsed.day };
    if (prev === null) {
      if (cur.month < currentMonth) year++;
    } else if (cur.month < prev.month || (cur.month === prev.month && cur.day < prev.day)) {
      year++;
    }
    prev = cur;
    return year;
  });
}

function flattenPageText(content: string): string {
  return decodeEntities(stripHtmlTags(content)).replaceAll(/\s+/g, " ").trim();
}

export class HashHorrorsAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const errorDetails: ErrorDetails = {};

    // Derive the WP.com site domain from source.url so the configured URL
    // is the single source of truth (matches the Seletar adapter pattern).
    let siteDomain = DEFAULT_SITE_DOMAIN;
    if (source.url) {
      try {
        siteDomain = new URL(source.url).hostname;
      } catch {
        // Fall back to the default if source.url is malformed.
      }
    }

    // Fetch archive and upcoming pages concurrently. Archive is the primary
    // feed (full 1993→present history); the upcoming page carries the 4-6
    // future runs that haven't yet been promoted into the archive.
    const [archiveResult, upcomingResult] = await Promise.all([
      fetchWordPressComPage(siteDomain, HARELINE_ARCHIVE_SLUG),
      fetchWordPressComPage(siteDomain, HARELINE_UPCOMING_SLUG),
    ]);

    // Archive failure is a hard error — the bulk of the data lives there.
    if (archiveResult.error || !archiveResult.page) {
      const message = archiveResult.error?.message ?? "WordPress.com API returned no archive page";
      errorDetails.fetch = [
        {
          url: `https://${siteDomain}/${HARELINE_ARCHIVE_SLUG}/`,
          message,
          status: archiveResult.error?.status,
        },
      ];
      return { events: [], errors: [message], errorDetails };
    }

    const archiveUrl = archiveResult.page.URL || `https://${siteDomain}/${HARELINE_ARCHIVE_SLUG}/`;
    const archiveText = flattenPageText(archiveResult.page.content);
    const archive = parseHashHorrorsHareline(archiveText);

    // Upcoming-page failure is soft — archive still provides the historical
    // data; we surface the warning so monitoring sees the partial fetch.
    const errors: string[] = [];
    const fetchErrors: NonNullable<ErrorDetails["fetch"]> = [];
    let upcomingUrl: string | undefined;
    let upcomingText = "";
    let upcoming: ParseHarelineResult = { events: [], skippedLines: 0, skippedMarkers: 0 };

    if (upcomingResult.error || !upcomingResult.page) {
      const message = upcomingResult.error?.message ?? "WordPress.com API returned no upcoming page";
      errors.push(message);
      fetchErrors.push({
        url: `https://${siteDomain}/${HARELINE_UPCOMING_SLUG}/`,
        message,
        status: upcomingResult.error?.status,
      });
    } else {
      upcomingUrl = upcomingResult.page.URL || `https://${siteDomain}/${HARELINE_UPCOMING_SLUG}/`;
      upcomingText = flattenPageText(upcomingResult.page.content);
      // Pin the implied year + month to Singapore-local "today" so a late-Dec
      // scrape that finds only January upcoming rows seeds them to next year
      // (gemini-code-assist review on PR #1536). UTC would also mis-date the
      // first 8h of January every year.
      const ymd = todayInTimezone(KENNEL_TIMEZONE);
      const currentYear = Number.parseInt(ymd.slice(0, 4), 10);
      const currentMonth = Number.parseInt(ymd.slice(5, 7), 10);
      upcoming = parseHashHorrorsUpcoming(upcomingText, currentYear, currentMonth);
    }

    // The hareline pages between them carry the full archive back to Hash 1.
    // Default to a 50-year window so the recurring scrape ingests the entire
    // historical archive regardless of founding date — the filter is a no-op
    // for events before the kennel existed, so going wide has no cost.
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 365 * 50);
    const allEvents = [
      ...archive.events.map((e) => ({ ...e, sourceUrl: archiveUrl })),
      ...(upcomingUrl ? upcoming.events.map((e) => ({ ...e, sourceUrl: upcomingUrl })) : []),
    ];
    const events = allEvents.filter((e) => {
      const d = new Date(`${e.date}T12:00:00Z`);
      return d >= minDate && d <= maxDate;
    });

    const skippedLines = archive.skippedLines + upcoming.skippedLines;
    const skippedMarkers = archive.skippedMarkers + upcoming.skippedMarkers;

    // Surface dropped lines as scrape errors so the reconciler doesn't cancel
    // events on a partial parse (it only runs when errors.length === 0). A
    // single dropped line is enough to suppress reconciliation since the format
    // is fragile and silent drops would be indistinguishable from real removals.
    const parseErrors: NonNullable<ErrorDetails["parse"]> = [];
    if (skippedLines > 0) {
      const message = `Hash Horrors hareline parser dropped ${skippedLines} line(s) — possible format drift`;
      errors.push(message);
      parseErrors.push({ row: 0, error: message });
    }

    if (fetchErrors.length > 0) errorDetails.fetch = fetchErrors;
    if (parseErrors.length > 0) errorDetails.parse = parseErrors;

    // Content-based fingerprint of the raw page HTML. The shared
    // `generateStructureHash` helper is hashnyc-specific (it looks for
    // `table.past_hashes` / `table.future_hashes` CSS classes that don't
    // exist on WordPress.com) and would return a constant for this adapter,
    // which is strictly worse than no signal at all. A SHA-256 over the raw
    // HTML changes on every edit — useful for diffing successive scrapes
    // even though it's noisier than a true structural fingerprint.
    const structureHash = createHash("sha256")
      .update(archiveResult.page.content + (upcomingResult.page?.content ?? ""))
      .digest("hex");
    return {
      events,
      errors,
      structureHash,
      errorDetails: errors.length > 0 ? errorDetails : undefined,
      diagnosticContext: {
        archivePageId: archiveResult.page.ID,
        archivePageModified: archiveResult.page.modified,
        upcomingPageId: upcomingResult.page?.ID,
        upcomingPageModified: upcomingResult.page?.modified,
        runsParsed: archive.events.length + upcoming.events.length,
        archiveRunsParsed: archive.events.length,
        upcomingRunsParsed: upcoming.events.length,
        skippedLines,
        skippedMarkers,
        eventsInWindow: events.length,
        archiveFetchDurationMs: archiveResult.fetchDurationMs,
        upcomingFetchDurationMs: upcomingResult.fetchDurationMs,
      },
    };
  }
}
