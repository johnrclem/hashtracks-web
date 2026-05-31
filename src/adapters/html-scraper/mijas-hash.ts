import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import {
  fetchHTMLPage,
  chronoParseDate,
  filterEventsByWindow,
  normalizeHaresField,
} from "../utils";

const DEFAULT_URL = "https://www.mijash3.com/hareline";
const KENNEL_TAG = "mijash3";

/**
 * Matches a `DD Month YYYY` date anywhere in a hareline line. Plain and
 * linear (no ReDoS shape — Sonar S5852). Case-insensitive to tolerate any
 * heading casing; chrono does the real parse on the matched slice.
 */
const HARELINE_DATE_RE =
  /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i;

/** Cheap gate: a hareline row starts with a 3–5 digit run number then a " - ". */
const RUN_ROW_RE = /^\d{3,5}[ab]?\s+-\s/;

/**
 * Field delimiter: a hyphen with whitespace on at least one side. Splitting on
 * this (rather than every "-") keeps hyphenated hare/theme text intact
 * ("Five-Knuckle Shuffle" stays one token) while still breaking the `- -`
 * empty-hares slot into an empty field. Two simple lookaround branches with no
 * quantifiers, so no backtracking (Sonar S5852-safe).
 */
const FIELD_DELIM_RE = /(?<=\s)-|-(?=\s)/;

/**
 * Parse the leading run number, dropping any `a`/`b` away-weekend suffix
 * (e.g. `1999a`/`1999b` share base #1999). Returns null when the segment
 * isn't a run number. The suffix is preserved separately via `parseRunLabel`
 * and emitted as `eventLabel` so the two sub-runs stay distinct events.
 */
export function parseRunNumber(token: string): number | null {
  const match = token.trim().match(/^(\d+)[ab]?\b/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Parse the `a`/`b` sub-letter that Mijas appends when two trails share a base
 * run number on different dates (e.g. `1999a` Memorial Run + `1999b` the week
 * after — issue #1848). Returned as `eventLabel`; without it both rows collapse
 * to `(sourceUrl, runNumber=1999)` and the merge same-sourceUrl date-correction
 * moves one onto the other's date, dropping a real event. Returns undefined for
 * a plain integer run number.
 */
export function parseRunLabel(token: string): string | undefined {
  const match = token.trim().match(/^\d+([ab])\b/);
  return match ? match[1] : undefined;
}

/**
 * Normalize a hares segment for stable fingerprints. Mijas joins co-hares
 * with `&` ("Shaggy & AguaSex"); we convert to commas and reuse the shared
 * sort/dedupe helper (idempotency — see Seletar #541).
 */
export function parseHares(segment: string): string | undefined {
  return normalizeHaresField(segment.split("&").join(","));
}

/**
 * Parse one hareline line of the form
 *   `<runNum>[ab] - <DD Month YYYY> - <hares?> - <theme?>`
 * into RawEventData. The date is found by content (NOT positionally and NOT
 * from any month heading) because the live DOM order is non-chronological.
 * The post-date tail is split on FIELD_DELIM_RE (a whitespace-adjacent hyphen),
 * which preserves hyphenated hare/theme text while still breaking the `- -`
 * empty-hares slot and the missing-space `-Memorial` form.
 * Returns null when no parseable date is present.
 */
export function parseHarelineLine(
  line: string,
  referenceDate = new Date(),
  sourceUrl = DEFAULT_URL,
): RawEventData | null {
  const trimmed = line.trim();
  const dateMatch = trimmed.match(HARELINE_DATE_RE);
  if (!dateMatch || dateMatch.index === undefined) return null;

  const date = chronoParseDate(dateMatch[0], "en-GB", referenceDate, {
    forwardDate: true,
  });
  if (!date) return null;

  const runNumber = parseRunNumber(trimmed);
  const eventLabel = parseRunLabel(trimmed);

  const remainder = trimmed.slice(dateMatch.index + dateMatch[0].length);
  const tokens = remainder.split(FIELD_DELIM_RE).map((t) => t.trim());
  if (tokens[0] === "") tokens.shift(); // drop the separator that follows the date
  const hares = parseHares(tokens[0] ?? "");
  const theme = tokens.slice(1).join(" - ").trim();

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber: runNumber ?? undefined,
    // `a`/`b` sub-letter (#1848). Distinguishes two same-run-number trails on
    // different dates so the merge date-correction doesn't collapse them; only
    // emitted when a suffix is present, so normal rows fingerprint unchanged.
    eventLabel,
    // Leave title undefined when there's no real theme — merge.ts synthesizes
    // "Mijas H3 Trail #N". Never let a hare name become the title.
    title: theme.length > 0 ? theme : undefined,
    hares,
    sourceUrl,
  };
}

/**
 * Mijas Hash House Harriers (MijasH3) — the Costa del Sol "Burro Hash".
 *
 * Scrapes the hand-maintained Squarespace hareline content page at
 * mijash3.com/hareline. The list is a <ul> of <li> lines whose text
 * (collapsed across color <span>s) reads `<runNum> - <DD Month YYYY> -
 * <hares?> - <theme?>`. Past runs are struck through (cosmetic only). DOM
 * order is NOT chronological, so each line's own date is parsed.
 */
export class MijasHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;

    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const referenceDate = new Date();
    let rowsFound = 0;

    const addParseError = (row: number, error: string, rawText: string) => {
      errorDetails.parse = [
        ...(errorDetails.parse ?? []),
        { row, section: "hareline", error, rawText: rawText.slice(0, 2000) },
      ];
    };

    $("li").each((i, el) => {
      const text = $(el).text().trim();
      if (!RUN_ROW_RE.test(text)) return; // skip nav / non-row list items
      rowsFound++;

      try {
        const event = parseHarelineLine(text, referenceDate, url);
        if (event) {
          events.push(event);
        } else {
          // A row that looks like a run row but won't parse (e.g. a typo'd
          // date) is a hard signal, not noise: push to errors[] so scrape.ts
          // suppresses reconcile. Otherwise the dropped future row looks
          // "removed from source" and its sole-source canonical gets CANCELLED.
          errors.push(`Unparseable hareline row ${i}: ${text.slice(0, 120)}`);
          addParseError(i, "Could not parse hareline row", text);
        }
      } catch (err) {
        errors.push(`Error parsing row ${i}: ${err}`);
        addParseError(i, String(err), text);
      }
    });

    const filtered = filterEventsByWindow(events, options?.days ?? 365);

    return {
      events: filtered,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        rowsFound,
        eventsParsed: filtered.length,
        totalBeforeFilter: events.length,
        fetchDurationMs,
      },
    };
  }
}
