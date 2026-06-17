import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchHTMLPage, stripHtmlTags, stripPlaceholder, MONTHS } from "../utils";

/**
 * Warsaw Hash House Harriers (warsaw-h3) — Warsaw, Poland.
 *
 * HashTracks' first Poland kennel: est. 1983, biweekly Saturday. The static
 * Mobirise v6.0.1 home page server-renders the whole forward feed inside a
 * SINGLE <p> with <br> separators — the next run in full detail plus a short
 * "Upcoming runs" list. After `stripHtmlTags(html, "\n")` the block linearizes
 * to visible-text lines:
 *
 *   WH3 Run #1643
 *   Sat 20 June 2026, 14h00            ← date (carries year) + time
 *   Where?
 *   Meet at the Presidential Hotel …   ← venue (next-run only)
 *   Who?
 *   The trail will be set by:          ← label, skipped
 *   Stiff Pointer                      ← hare
 *   Upcoming runs
 *   #1644 July 4, 2026                 ← run # + date (Month D, YYYY)
 *   Hare: Chasing Yanks                ← hare
 *   …
 *
 * Mobirise wraps every block in rotating opaque class names AND the page has a
 * second <p class="… display-7"> blurb, so detection keys on the visible
 * `WH3 Run #` / `Upcoming runs` / `Where?` / `Who?` / `Hare:` markers, never on
 * CSS selectors. Dates carry the year → NO year inference. The "next run" block
 * and the list are two shapes on one page; they merge by run number.
 *
 * Single-page rolling feed (no archive): `config.upcomingOnly: true` protects
 * reconcile as runs age off, and a fail-loud zero-row guard surfaces markup
 * drift instead of a silent `events: []` (the zero-event health alert can't
 * catch that on a brand-new source whose baseline is already 0).
 */

const KENNEL_TAG = "warsaw-h3";
const DEFAULT_URL = "https://warsawh3.com/";

// "WH3 Run #1643" → run number (next-run detail header).
const NEXT_RUN_RE = /WH3 Run #(\d{2,5})/i;
// "#1644 July 4, 2026" → run number + "Month D, YYYY" (upcoming-list row).
const LIST_ENTRY_RE = /#(\d{2,5})\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/;
// "Sat 20 June 2026, 14h00" → day / month word / year.
const DMY_DATE_RE = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/;
// "July 4, 2026" → month word / day / year. Month bounded to 3–9 letters (the
// length range of English month names) and single `\s` separators so the
// leading group can't backtrack super-linearly (S5852).
const MDY_DATE_RE = /([A-Za-z]{3,9})\s(\d{1,2}),\s(\d{4})/;
// "14h00" → hour / minute (Mobirise time format).
const TIME_RE = /(\d{1,2})h(\d{2})/;
// "Hare: Chasing Yanks" → hare name. No leading `\s*` (it would overlap the
// `.+` and trip S5852); the captured value is trimmed in cleanHare.
const HARE_LINE_RE = /^Hare:(.+)$/i;
const WHERE_RE = /^where\??$/i;
const WHO_RE = /^who\??$/i;
const UPCOMING_RE = /^upcoming runs$/i;
const SET_BY_RE = /trail will be set by/i;

// Imported MONTHS Record → Map (1-indexed month numbers; avoids object-injection).
const MONTH_NUMBERS = new Map<string, number>(Object.entries(MONTHS));

// Warsaw H3's standing hare-needed in-joke. The universal placeholders (`???`,
// `TBA`, `Hare needed`…) are handled by the shared `stripPlaceholder`; only this
// kennel-specific phrase needs a local guard.
const WARSAW_HARE_PLACEHOLDER_RE = /^it could be you[!.]*$/i;

/** Trimmed value or undefined for empty cells. */
function cleanText(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

/**
 * Resolve a hare cell to the merge pipeline's tri-state (#2032):
 *  - real hare name → the string
 *  - a RECOGNIZED placeholder (`???`, `It Could Be You!`, `TBA`, `Hare needed`)
 *    → `null` (explicit clear — the source is saying "no hare yet", so any hare
 *    previously stored on the canonical event must be cleared, not preserved)
 *  - genuinely absent (no hare field at all) → `undefined` (no signal, preserve)
 *
 * Returning `undefined` for a placeholder would let a stale hare survive a
 * source correction, since merge treats `undefined` as preserve-existing.
 */
function cleanHare(value: string | undefined): string | null | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const hare = stripPlaceholder(trimmed);
  if (!hare || WARSAW_HARE_PLACEHOLDER_RE.test(hare)) return null;
  return hare;
}

/** Build a UTC-noon `YYYY-MM-DD`, rejecting impossible dates (e.g. 31 in a 30-day month). */
function toUtcNoon(year: number, monthWord: string, day: number): string | null {
  const month = MONTH_NUMBERS.get(monthWord.slice(0, 3).toLowerCase());
  if (!month || day < 1 || day > 31 || !Number.isFinite(year)) return null;
  const utc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (utc.getUTCDate() !== day || utc.getUTCMonth() !== month - 1) return null;
  return utc.toISOString().slice(0, 10);
}

/** "Sat 20 June 2026, 14h00" → UTC-noon date string, or null. */
function parseDmyDate(line: string): string | null {
  const m = DMY_DATE_RE.exec(line);
  if (!m) return null;
  return toUtcNoon(Number.parseInt(m[3], 10), m[2], Number.parseInt(m[1], 10));
}

/** "July 4, 2026" → UTC-noon date string, or null. */
function parseMdyDate(text: string): string | null {
  const m = MDY_DATE_RE.exec(text);
  if (!m) return null;
  return toUtcNoon(Number.parseInt(m[3], 10), m[1], Number.parseInt(m[2], 10));
}

/** "14h00" → "14:00", or undefined. */
function parseTime(line: string): string | undefined {
  const m = TIME_RE.exec(line);
  if (!m) return undefined;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/**
 * Parse the detailed "next run" block (header at `startIdx`, bounded by the
 * "Upcoming runs" heading at `endIdx`). Carries date, time, venue, and hare.
 */
function parseNextRunBlock(
  lines: string[],
  startIdx: number,
  endIdx: number,
  sourceUrl: string,
): RawEventData | null {
  const runMatch = NEXT_RUN_RE.exec(lines[startIdx]);
  if (!runMatch) return null;
  const runNumber = Number.parseInt(runMatch[1], 10);

  const block = lines.slice(startIdx + 1, endIdx);

  let date: string | null = null;
  let startTime: string | undefined;
  for (const line of block) {
    if (!date) date = parseDmyDate(line);
    if (!startTime) startTime = parseTime(line);
  }
  if (!date) return null;

  const whereIdx = block.findIndex((l) => WHERE_RE.test(l));
  const location = whereIdx === -1 ? undefined : cleanText(block[whereIdx + 1]);

  const whoIdx = block.findIndex((l) => WHO_RE.test(l));
  let hares: string | null | undefined;
  if (whoIdx !== -1) {
    const hareLines = block
      .slice(whoIdx + 1)
      .filter((l) => !SET_BY_RE.test(l) && !WHERE_RE.test(l));
    hares = cleanHare(hareLines.join(", "));
  }

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    // title intentionally undefined → merge.ts synthesizes "Warsaw H3 Trail #N".
    hares,
    location,
    startTime,
    sourceUrl,
  };
}

/** Parse the "Upcoming runs" list rows (run # + date on one line, hare on the next). */
function parseUpcomingList(lines: string[], sourceUrl: string): RawEventData[] {
  const events: RawEventData[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = LIST_ENTRY_RE.exec(lines[i]);
    if (!m) continue;
    const date = parseMdyDate(m[2]);
    if (!date) continue;
    const hareMatch = HARE_LINE_RE.exec(lines[i + 1] ?? "");
    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber: Number.parseInt(m[1], 10),
      hares: hareMatch ? cleanHare(hareMatch[1]) : undefined,
      sourceUrl,
    });
  }
  return events;
}

/** Defined incoming value wins (incl. an explicit `null` clear); `undefined` keeps existing. */
function keep<T>(next: T | undefined, prev: T | undefined): T | undefined {
  return next !== undefined ? next : prev;
}

/**
 * Merge two rows for the same run (the next-run detail block vs an upcoming-list
 * row). Field-by-field rather than winner-take-all, preserving the merge
 * pipeline's tri-state so neither shape's data is dropped: a richer next-run
 * row's venue/time survive a later list row that omits them, and a list row's
 * explicit `null` hare clear still wins.
 */
function upsertEvent(map: Map<number, RawEventData>, event: RawEventData): void {
  const runNumber = event.runNumber;
  if (typeof runNumber !== "number") return;
  const existing = map.get(runNumber);
  if (!existing) {
    map.set(runNumber, event);
    return;
  }
  map.set(runNumber, {
    ...existing,
    hares: keep(event.hares, existing.hares),
    location: keep(event.location, existing.location),
    startTime: keep(event.startTime, existing.startTime),
    sourceUrl: keep(event.sourceUrl, existing.sourceUrl),
  });
}

/**
 * Parse the Warsaw H3 Mobirise home page into RawEvents. The next-run detail
 * block and the upcoming-runs list are merged by run number.
 */
export function parseWarsawH3Page(
  html: string,
  sourceUrl: string,
): { events: RawEventData[]; errors: string[] } {
  const lines = stripHtmlTags(html, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const eventsByRun = new Map<number, RawEventData>();

  const nextRunIdx = lines.findIndex((l) => NEXT_RUN_RE.test(l));
  if (nextRunIdx !== -1) {
    // Bound the next-run block at the first upcoming-list marker — either the
    // "Upcoming runs" heading OR the first "#NNNN Month D, YYYY" row. Keying on
    // the list row too means a heading-text drift can't let list lines bleed
    // into the next run's hare field.
    let endIdx = lines.length;
    for (let i = nextRunIdx + 1; i < lines.length; i++) {
      if (UPCOMING_RE.test(lines[i]) || LIST_ENTRY_RE.test(lines[i])) {
        endIdx = i;
        break;
      }
    }
    const nextRun = parseNextRunBlock(lines, nextRunIdx, endIdx, sourceUrl);
    if (nextRun) upsertEvent(eventsByRun, nextRun);
  }

  for (const event of parseUpcomingList(lines, sourceUrl)) {
    upsertEvent(eventsByRun, event);
  }

  const events = [...eventsByRun.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { events, errors: [] };
}

/**
 * Warsaw Hash House Harriers (WH3) HTML Scraper.
 *
 * Fetches the static Mobirise home page (plain Cheerio, no browser render).
 * `options.days` is ignored: the page renders exactly the forward feed (~4
 * runs), with no date range to filter. Fingerprint dedup handles repeat scrapes.
 */
export class WarsawH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, _options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { html, structureHash, fetchDurationMs } = page;
    const { events, errors } = parseWarsawH3Page(html, url);

    if (events.length === 0) {
      errors.push("Warsaw H3: no run rows parsed — Mobirise markup may have changed");
    }

    return {
      events,
      errors,
      structureHash,
      diagnosticContext: { eventsParsed: events.length, fetchDurationMs },
    };
  }
}
