import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ParseError } from "../types";
import {
  fetchHTMLPage,
  filterEventsByWindow,
  formatAmPmTime,
  chronoParseDate,
  isPlaceholder,
} from "../utils";
import { scrubHarePii } from "../hare-pii";

const KENNEL_TAG = "bombay-h3";
const DEFAULT_URL = "https://bombayhash.org/";

// Run headings vary: "RUN #631", "BH3 RUN #629", "BOMBAY HASH RUN #628",
// "# Run 627 yeoor hill thane". One is an <h2>, others <h3> — so we key on the
// heading TEXT, not the tag level. 3–4 digit run numbers (#627 → #631 today).
const RUN_HEADING_RE = /\bRUN\s*#?\s*(\d{3,4})\b/i;

// The run date is the ONLY date carrying a 4-digit year on the page. Rego
// deadlines ("till Friday, 26th June") and discounts ("since Jan") never carry
// a year, so requiring "20YY" cleanly isolates the run date from the noise.
// Three simple capture groups, no alternation-adjacent quantifiers (Sonar
// S5852/S5843 safe). The optional leading weekday is left for chrono to ignore.
const DATE_RE = /\b\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\.?\s+20\d{2}\b/;

// The sole AM/PM wall-clock on the page is the assembly time ("9:30 AM",
// "09:30 AM"). Markers vary (🕘 Time:, ⏰ Assembly:, TIME:), so we ignore the
// label and grab the first clock time.
const TIME_RE = /\b(\d{1,2})[:.](\d{2})\s*([AP]M)\b/i;

// Rego amounts. The standard fee is the kennel default (₹250/₹400 on hashCash);
// only a clearly-special per-event price (anniversary runs, ≥ ₹1000) is worth
// storing on the Event. Currency is written as "₹", "INR", or "Rs".
const REGO_AMOUNT_RE = /(?:₹|INR|Rs\.?)\s*(\d{3,5})/gi;
const SPECIAL_REGO_FLOOR = 1000;

// Field-boundary emoji that terminate a field value. Deliberately EXCLUDES the
// beer emoji (🍻/🍺) — Run #630's venue is prefixed with 🍻 ("🍻 SOCIAL – NESCO …").
// Single-codepoint glyphs only so the character class is well-formed.
const FIELD_END_RE = /[🐇💰📲⚠📅🕘🕤⏰🕐🐾🤔]/u;
const VENUE_LABEL_RE = /^\s*(?:venue)\s*:?\s*/i;
// Leading decoration to strip from a captured venue: any run of non-letter,
// non-digit characters (emoji, dashes, colons, spaces) so "🍻 SOCIAL – …" → "SOCIAL – …".
const LEADING_DECORATION_RE = /^[^\p{L}\p{N}]+/u;

// A real hares field is the "🐇 HARES:" label — the COLON is mandatory so the
// jokey prose ("Unless You're the Hare!", "Hares will disappear 🐇") never
// matches. Placeholder values ("???", "TBA", …) are rejected via the shared
// isPlaceholder() helper; empty values fall through to the length guard below.
const HARES_LABEL_RE = /\bhares?\s*:/i;

interface RunBlock {
  runNumber: number;
  text: string;
  rawHeading: string;
  row: number;
}

function normalize(raw: string): string {
  return raw.replaceAll(/\s+/g, " ").trim();
}

/**
 * Collect each run's block. Run headings live inside Spectra containers whose
 * body paragraphs are NOT siblings of the heading, so from each RUN heading we
 * climb to the nearest ancestor whose text already carries the year-bearing run
 * date — that ancestor is the per-run block. The climb is capped and stops at
 * the page-level wrappers so we never accidentally swallow the whole
 * `.entry-content` (all runs) for a single heading.
 */
function collectRunBlocks($: CheerioAPI): RunBlock[] {
  const blocks: RunBlock[] = [];
  const seen = new Set<number>();
  const STOP_TAGS = new Set(["article", "main", "body", "html"]);

  $("h1, h2, h3, h4").each((row, el) => {
    const heading = normalize($(el).text());
    const m = RUN_HEADING_RE.exec(heading);
    if (!m) return;
    const runNumber = Number.parseInt(m[1], 10);
    if (seen.has(runNumber)) return;

    // Climb to the block container that holds this run's dated body.
    let node = $(el).parent();
    let blockText: string | null = null;
    for (let depth = 0; depth < 6 && node.length > 0; depth++) {
      const tag = (node[0] as Element).tagName?.toLowerCase();
      const cls = node.attr("class") ?? "";
      // Stop BEFORE inspecting the page-level wrapper: `.entry-content` holds
      // every run's text, so a dateless block (markup drift) would otherwise
      // match a SIBLING run's date here and silently mis-date itself.
      if ((tag && STOP_TAGS.has(tag)) || cls.includes("entry-content")) break;
      const nodeText = node.text(); // recursive subtree concat — compute once
      if (DATE_RE.test(nodeText)) {
        blockText = nodeText;
        break;
      }
      node = node.parent();
    }

    seen.add(runNumber);
    // No dated ancestor → record the run with the heading text only; date
    // parsing below fails loud (per-run drift), it is NOT silently dropped.
    blocks.push({ runNumber, text: normalize(blockText ?? heading), rawHeading: heading, row });
  });

  return blocks;
}

function parseDate(text: string): string | null {
  const m = DATE_RE.exec(text);
  if (!m) return null;
  // chronoParseDate parses the ordinal ("28th June 2026") natively and returns
  // "YYYY-MM-DD"; the year is explicit so there is no inference.
  return chronoParseDate(m[0], "en-GB");
}

function parseTime(text: string): string | undefined {
  const m = TIME_RE.exec(text);
  if (!m) return undefined;
  const hour = Number.parseInt(m[1], 10);
  const minute = Number.parseInt(m[2], 10);
  if (hour < 1 || hour > 12 || minute > 59) return undefined;
  return formatAmPmTime(hour, minute, m[3]);
}

function parseVenue(text: string): string | undefined {
  const pin = text.indexOf("📍");
  if (pin < 0) return undefined;
  // Drop the "Venue:" label, then strip leading decoration (emoji/dashes) so a
  // 🍻-prefixed venue surfaces its real text, THEN cut at the next field marker.
  let rest = text.slice(pin + "📍".length).replace(VENUE_LABEL_RE, "");
  rest = rest.replace(LEADING_DECORATION_RE, "");
  const endMatch = FIELD_END_RE.exec(rest);
  if (endMatch && endMatch.index > 0) rest = rest.slice(0, endMatch.index);
  rest = rest.trim();
  // Defensive PII scrub (phones/payee never live in the venue segment because
  // it terminates before the 💰/📲 rego markers, but belt-and-suspenders).
  const cleaned = scrubHarePii(rest);
  return cleaned && cleaned.length >= 3 ? cleaned : undefined;
}

function parseHares(text: string): string | undefined {
  const labelMatch = HARES_LABEL_RE.exec(text);
  if (!labelMatch) return undefined;
  // Cut at the next field marker BEFORE trimming so the "???" placeholder is
  // preserved for the placeholder check (a leading-decoration strip would eat it).
  let rest = text.slice(labelMatch.index + labelMatch[0].length);
  const endMatch = FIELD_END_RE.exec(rest);
  if (endMatch && endMatch.index > 0) rest = rest.slice(0, endMatch.index);
  rest = rest.trim();
  if (isPlaceholder(rest)) return undefined;
  const cleaned = scrubHarePii(rest);
  return cleaned && cleaned.length >= 2 ? cleaned : undefined;
}

/** Emit a special rego price only when it clearly exceeds the standard fee. */
function parseSpecialCost(text: string): string | undefined {
  let max = 0;
  for (const m of text.matchAll(REGO_AMOUNT_RE)) {
    const amount = Number.parseInt(m[1], 10);
    if (amount > max) max = amount;
  }
  return max >= SPECIAL_REGO_FLOOR ? `₹${max}` : undefined;
}

export function parseBombayHashPage(html: string): {
  events: RawEventData[];
  parseErrors: ParseError[];
  blockCount: number;
} {
  const $ = cheerio.load(html);
  const blocks = collectRunBlocks($);
  const events: RawEventData[] = [];
  const parseErrors: ParseError[] = [];

  for (const block of blocks) {
    const date = parseDate(block.text);
    if (!date) {
      // A numbered run whose date no longer parses is markup drift, not a
      // legitimately-absent run. Surface it so fetch() suppresses reconcile —
      // the windowed-empty guard alone misses partial drift (Kaohsiung lesson).
      parseErrors.push({
        row: block.row,
        section: "run_information",
        field: "date",
        error: `Bombay H3: could not parse date for run #${block.runNumber}`,
        rawText: block.rawHeading.slice(0, 200),
      });
      continue;
    }

    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber: block.runNumber,
      // title left undefined → merge synthesizes "Bombay H3 Trail #N".
      startTime: parseTime(block.text),
      location: parseVenue(block.text),
      hares: parseHares(block.text),
      cost: parseSpecialCost(block.text),
      sourceUrl: DEFAULT_URL,
    });
  }

  return { events, parseErrors, blockCount: blocks.length };
}

/**
 * Bombay Hash House Harriers (Mumbai, est. 1983) HTML scraper.
 *
 * The first India kennel on HashTracks. bombayhash.org is a freshly-built
 * (Feb 2026) WordPress 6.9.4 + Astra/Spectra site whose home page SSRs every
 * current run block (#627 → #631, monthly Sunday 9:30 AM trails), so a static
 * Cheerio parse suffices — no browser render. Each run is a Spectra container
 * with a "RUN #NNN" heading and a run-together paragraph carrying emoji-anchored
 * fields (📅 Date / 🕘 Time / 📍 Venue) plus heavy jokey prose. The rego lines
 * carry PII (phone numbers, payee names) and the page embeds a join/waiver form;
 * the adapter reads only the run blocks, extracts only the dated fields, and
 * never stores the prose, so PII never enters a field. There is no archive to
 * backfill (the site is months old). `upcomingOnly` protects the already-run
 * blocks from reconcile false-cancellation as the committee ages them off.
 */
export class BombayHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { html, structureHash, fetchDurationMs } = page;
    const { events, parseErrors, blockCount } = parseBombayHashPage(html);

    // Wide default window: the home page is a tiny rolling set (≤ ~5 runs, no
    // archive) spanning several months, so a generous ±window captures every
    // currently-posted run (incl. the oldest still on the page) rather than
    // clipping it on the symmetric ±days filter. `upcomingOnly` on the source
    // keeps the already-run blocks safe from reconcile false-cancellation.
    const windowed = filterEventsByWindow(events, options?.days ?? 365);
    const errors: string[] = parseErrors.map((p) => p.error);

    // Fail-loud: a single SSR surface can't lean on the zero-event health alert.
    // An empty result — whether from whole-page markup drift (no run headings)
    // or every run falling outside the window — means nothing to publish, so
    // surface an error and suppress reconcile (don't false-CANCEL live runs).
    if (windowed.length === 0) {
      errors.push(
        `Bombay H3: no upcoming runs from ${url} (${events.length} parsed, ${blockCount} run blocks)`,
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
