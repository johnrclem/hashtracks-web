import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ParseError } from "../types";
import {
  fetchHTMLPage,
  filterEventsByWindow,
  formatAmPmTime,
  normalizeHaresField,
  stripZeroWidth,
} from "../utils";

const KENNEL_TAG = "kaohsiung-h3";
const DEFAULT_URL = "https://www.kaohsiunghash.com/run-information";

// A run heading looks like "#2732 June 27 Saturday Night Run". The "#NNNN"
// marks a run; non-run content blocks (sponsor bar, "Dragon Boats", etc.)
// carry no run number and are skipped.
const RUN_RE = /#\s*(\d{3,5})\b/;

// Month + day parsed in two simple passes (avoids a single ReDoS-shaped regex
// per the Sonar S5852/S5843 guidance and the boiseh3 two-pass precedent).
// MONTH_WORD_RE only yields candidate alphabetic words (no month alternation,
// so no regex-complexity bump); each candidate is validated by exact lookup in
// MONTH_INDEX, which also rules out near-words like "Maybe".
const MONTH_WORD_RE = /\b[a-z]{3,9}\b/gi;
const DAY_RE = /^\s*(\d{1,2})\b/;
// Keyed by both full name and abbreviation so the matched month word is looked
// up exactly. A Map avoids object-key injection on a computed lookup (flagged
// by Gemini / detect-object-injection).
const MONTH_INDEX = new Map<string, number>([
  ["january", 0], ["jan", 0],
  ["february", 1], ["feb", 1],
  ["march", 2], ["mar", 2],
  ["april", 3], ["apr", 3],
  ["may", 4],
  ["june", 5], ["jun", 5],
  ["july", 6], ["jul", 6],
  ["august", 7], ["aug", 7],
  ["september", 8], ["sep", 8],
  ["october", 9], ["oct", 9],
  ["november", 10], ["nov", 10],
  ["december", 11], ["dec", 11],
]);

// Time prose: a 12-hour clock ("6:30PM", "7PM") or a bare 24-hour clock
// ("around 19:00"). Two separate patterns, scanned in priority order.
// `\s?` (not `\s*`) keeps the AM/PM join free of the S5852 backtracking shape.
const TIME_12H_RE = /\b(\d{1,2})(?::([0-5]\d))?\s?([AaPp][Mm])\b/;
const TIME_24H_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;

// Cost prose: "Run Costs are NTD300 per person".
const COST_RE = /\bNTD?\$?\s?(\d{2,5})\b/i;

// Maps links are validated against an https + host allowlist (mirrors
// taipei-hash.ts MAPS_HOSTS; Codacy flags un-validated variable URLs).
const MAPS_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "google.com",
  "www.google.com",
  "maps.google.com",
]);

// Venue placeholders that should NOT be stored as a location.
const PLACEHOLDER_VENUE_RE = /\b(stay tuned|tba|tbd|to come|to be (?:announced|decided))\b/i;

interface Block {
  text: string;
  mapsUrl?: string;
}

interface ParsedRun {
  runNumber: number;
  date: string;
  title?: string;
  hares?: string;
  location?: string;
  locationUrl?: string;
  startTime?: string;
  cost?: string;
  description?: string;
}

function normalizeText(raw: string): string {
  return stripZeroWidth(raw).replaceAll(/\s+/g, " ").trim();
}

function isValidMapsUrl(href: string): boolean {
  try {
    const parsed = new URL(href);
    return parsed.protocol === "https:" && MAPS_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Resolve a year-less month/day to the nearest upcoming "YYYY-MM-DD" (UTC). */
function resolveForwardDate(monthIdx: number, day: number, now: Date): string {
  const PAST_GRACE_MS = 60 * 24 * 3600 * 1000;
  const year = now.getUTCFullYear();
  let ms = Date.UTC(year, monthIdx, day, 12, 0, 0);
  if (ms < now.getTime() - PAST_GRACE_MS) {
    ms = Date.UTC(year + 1, monthIdx, day, 12, 0, 0);
  }
  return new Date(ms).toISOString().slice(0, 10);
}

function findMonth(afterRun: string): { monthIdx: number; afterMonth: string } | null {
  for (const m of afterRun.matchAll(MONTH_WORD_RE)) {
    const monthIdx = MONTH_INDEX.get(m[0].toLowerCase());
    if (monthIdx !== undefined) {
      return { monthIdx, afterMonth: afterRun.slice(m.index + m[0].length) };
    }
  }
  return null;
}

function parseHeadingDate(afterRun: string, now: Date): { date: string; title?: string } | null {
  const month = findMonth(afterRun);
  if (!month) return null;
  const { monthIdx, afterMonth } = month;

  const dm = DAY_RE.exec(afterMonth);
  if (!dm) return null;
  const day = Number.parseInt(dm[1], 10);
  if (day < 1 || day > 31) return null;

  const date = resolveForwardDate(monthIdx, day, now);
  const title = afterMonth.slice(dm.index + dm[0].length).trim();
  return { date, title: title || undefined };
}

function parseStartTime(prose: string, title: string | undefined): string | undefined {
  const m12 = TIME_12H_RE.exec(prose);
  if (m12) {
    const hour = Number.parseInt(m12[1], 10);
    const minute = m12[2] ? Number.parseInt(m12[2], 10) : 0;
    // Only a real 1–12 clock hour is a 12-hour time ("13PM" is junk).
    if (hour >= 1 && hour <= 12 && minute <= 59) {
      return formatAmPmTime(hour, minute, m12[3]);
    }
  }
  const m24 = TIME_24H_RE.exec(prose);
  if (m24) {
    return `${m24[1].padStart(2, "0")}:${m24[2]}`;
  }
  // Fallback by run type from the heading/title.
  const label = (title ?? "").toLowerCase();
  if (label.includes("night")) return "19:00";
  if (label.includes("afternoon")) return "13:00";
  if (label.includes("family") || label.includes("sunday")) return "09:00";
  return undefined;
}

// Venue cue. The `\b` word boundary avoids false positives inside a larger
// word ("timeet at"); `\s+` absorbs arbitrary spacing before the venue text.
const MEET_AT_RE = /\bmeet at\s+/i;

function parseLocation(prose: string): string | undefined {
  const m = MEET_AT_RE.exec(prose);
  if (!m) return undefined;
  let rest = prose.slice(m.index + m[0].length);
  const dot = rest.indexOf(".");
  if (dot >= 0) rest = rest.slice(0, dot);
  rest = rest.trim();
  if (!rest || PLACEHOLDER_VENUE_RE.test(rest)) return undefined;
  return rest;
}

function parseCost(prose: string): string | undefined {
  const m = COST_RE.exec(prose);
  return m ? m[0].trim() : undefined;
}

/**
 * Parse the Kaohsiung H3 /run-information page. Each run is a sequence of
 * Wix `[data-testid="richTextElement"]` blocks: a "#NNNN Month Day Title"
 * heading, free-form prose (time, cost, "Meet at …", a maps link), a
 * "Your Hares:" label, then the hare names. Blocks are walked in document
 * order and grouped by run heading.
 */
/** Flatten the Wix rich-text blocks (text + first valid maps link) in order. */
function collectBlocks(html: string): Block[] {
  const $ = cheerio.load(html);
  const blocks: Block[] = [];
  $('[data-testid="richTextElement"]').each((_i, el) => {
    const $el = $(el);
    const text = normalizeText($el.text());
    if (!text) return;
    let mapsUrl: string | undefined;
    $el.find("a").each((_j, a) => {
      if (mapsUrl) return;
      const href = $(a).attr("href")?.trim();
      if (href && isValidMapsUrl(href)) mapsUrl = href;
    });
    blocks.push({ text, mapsUrl });
  });
  return blocks;
}

const HARES_LABEL_RE = /^your hares:?$/i;

/** Collect a run's body blocks: hares (after a "Your Hares:" label) + prose. */
function parseRunBody(
  blocks: Block[],
  start: number,
  end: number,
): { hares?: string; locationUrl?: string; prose: string } {
  let hares: string | undefined;
  let locationUrl: string | undefined;
  const proseParts: string[] = [];
  for (let i = start + 1; i < end; i++) {
    const block = blocks[i];
    if (HARES_LABEL_RE.test(block.text)) {
      const next = blocks[i + 1];
      if (next && i + 1 < end) hares = normalizeHaresField(next.text);
      i += 1; // consume the hares value block
      continue;
    }
    proseParts.push(block.text);
    locationUrl ??= block.mapsUrl;
  }
  return { hares, locationUrl, prose: proseParts.join(" ") };
}

/** Build one run from its heading block + body, or a parse error on drift. */
function buildRun(
  blocks: Block[],
  start: number,
  end: number,
  now: Date,
): { run?: ParsedRun; error?: ParseError } {
  const heading = blocks[start].text;
  const rm = RUN_RE.exec(heading);
  if (!rm) return {};
  const runNumber = Number.parseInt(rm[1], 10);

  const afterRun = heading.slice(rm.index + rm[0].length).trim();
  const dateParsed = parseHeadingDate(afterRun, now);
  if (!dateParsed) {
    // A numbered run whose date no longer parses is markup drift, NOT a
    // legitimately-absent run. Record a parse error so fetch() suppresses
    // reconcile.ts — silently dropping it would let the reconciler false-CANCEL
    // this run's sole-source canonical even though the page still lists it (the
    // windowed-empty guard alone misses partial drift).
    return {
      error: {
        row: start,
        section: "run_information",
        field: "date",
        error: `Kaohsiung H3: could not parse date for run #${runNumber}`,
        rawText: heading.slice(0, 200),
      },
    };
  }

  const rawTitle = dateParsed.title;
  const { hares, locationUrl, prose } = parseRunBody(blocks, start, end);
  return {
    run: {
      runNumber,
      date: dateParsed.date,
      // Trust the source-provided title — the heading after the date is the
      // run's real name ("Saturday Night Run", "7-eleven Joint Night Run"),
      // single- or multi-line. Headings with no text after the date leave
      // rawTitle undefined → merge synthesizes "Kaohsiung H3 Trail #N" (#2225).
      title: rawTitle,
      hares,
      location: parseLocation(prose),
      locationUrl,
      startTime: parseStartTime(prose, rawTitle),
      cost: parseCost(prose),
      description: prose || undefined,
    },
  };
}

/**
 * Parse the Kaohsiung H3 /run-information page. Each run is a sequence of
 * Wix `[data-testid="richTextElement"]` blocks: a "#NNNN Month Day Title"
 * heading, free-form prose (time, cost, "Meet at …", a maps link), a
 * "Your Hares:" label, then the hare names. Blocks are walked in document
 * order and grouped by run heading.
 */
export function parseKaohsiungHashPage(
  html: string,
  now: Date,
): { runs: ParsedRun[]; blockCount: number; parseErrors: ParseError[] } {
  const blocks = collectBlocks(html);
  const runStarts = blocks.reduce<number[]>((acc, b, i) => {
    if (RUN_RE.test(b.text)) acc.push(i);
    return acc;
  }, []);

  const runs: ParsedRun[] = [];
  const parseErrors: ParseError[] = [];
  for (let s = 0; s < runStarts.length; s++) {
    const start = runStarts[s];
    const end = s + 1 < runStarts.length ? runStarts[s + 1] : blocks.length;
    const { run, error } = buildRun(blocks, start, end, now);
    if (run) runs.push(run);
    else if (error) parseErrors.push(error);
  }

  return { runs, blockCount: blocks.length, parseErrors };
}

function toRawEvent(run: ParsedRun, sourceUrl: string): RawEventData {
  return {
    date: run.date,
    kennelTags: [KENNEL_TAG],
    runNumber: run.runNumber,
    title: run.title,
    hares: run.hares,
    location: run.location,
    locationUrl: run.locationUrl,
    startTime: run.startTime,
    cost: run.cost,
    description: run.description,
    sourceUrl,
  };
}

/**
 * Kaohsiung Hash House Harriers (高雄捷兔) HTML scraper.
 *
 * Southern Taiwan's oldest hash (est. 1973). The Wix-hosted /run-information
 * page is fully server-rendered, so a static Cheerio parse suffices (no
 * browser render). The page surfaces only the next ~2–3 numbered runs (the
 * full schedule is published as an image), so the source is configured
 * `upcomingOnly` and there is no historical archive to backfill.
 */
export class KaohsiungHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { html, structureHash, fetchDurationMs } = page;
    const { runs, blockCount, parseErrors } = parseKaohsiungHashPage(html, new Date());

    const events = runs.map((run) => toRawEvent(run, url));
    const windowed = filterEventsByWindow(events, options?.days ?? 90);

    // Any numbered block that failed to fully parse is markup drift: surface it
    // so scrape.ts suppresses stale reconciliation even when OTHER runs parsed
    // fine (partial drift). Without this, a single drifted heading would let the
    // reconciler false-CANCEL that run's sole-source canonical while the page
    // still lists it.
    const errors: string[] = parseErrors.map((p) => p.error);

    // Fail-loud: a single SSR surface with a 0-event baseline can't rely on the
    // zero-event health alert. This is a weekly kennel, so an empty result —
    // whether from markup drift (nothing parsed) or every run falling outside
    // the window — means we have nothing to publish; surface an error so
    // reconcile.ts is suppressed (don't false-CANCEL) and the drift is visible.
    if (windowed.length === 0) {
      errors.push(
        `Kaohsiung H3: no upcoming runs from ${url} ` +
          `(${events.length} parsed, ${blockCount} content blocks)`,
      );
    }

    return {
      events: windowed,
      errors,
      errorDetails: parseErrors.length > 0 ? { parse: parseErrors } : undefined,
      structureHash,
      diagnosticContext: {
        eventsParsed: windowed.length,
        totalBeforeFilter: events.length,
        blockCount,
        skippedNumbered: parseErrors.length,
        fetchDurationMs,
      },
    };
  }
}
