import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import {
  buildDateWindow,
  bumpYearIfBefore,
  chronoParseDate,
  normalizeHaresField,
  stripPlaceholder,
} from "../utils";
import { safeFetch } from "../safe-fetch";
import { generateStructureHash } from "@/pipeline/structure-hash";

/**
 * Auckland Hussies HTML Scraper
 *
 * Source: https://aucklandhussies.co.nz/Run%20List.html — a Microsoft Excel
 * "Save as Web Page" export. Each run is a 6-column `<tr>` whose first cell
 * is a short date like `5-May`; subsequent cells hold hares and address.
 * Annotation rows (phone numbers, "Please text the hare", cost notes) all
 * have an empty first cell, so date-shaped col-0 is the row discriminator.
 *
 * Year inference uses refDate-year + monotonic-walk year bump across the
 * chronologically-sorted run list, so a Dec → Jan rollover correctly maps
 * the January run into next year.
 *
 * Encoding: the source emits windows-1252 bytes (NBSP = 0xA0, smart quotes)
 * but declares the charset only in `<meta http-equiv=Content-Type ...>` —
 * never in the HTTP header. We bypass `fetchHTMLPage` (which assumes UTF-8
 * via `response.text()`) and use {@link fetchCharsetAwareHTMLPage} to read
 * the bytes, sniff the charset from header → meta tag → windows-1252
 * fallback, and decode accordingly. See #1506.
 */

// Allowed date shapes in column 0 — strict `D[D]-MMM` to avoid grabbing
// stray text like "021-420209" (phone numbers in adjacent rows).
const DATE_CELL_RE = /^\s*(\d{1,2})-([A-Za-z]{3})\s*$/;

// The source is an Excel "Save as Web Page" export that emits windows-1252
// bytes (NBSP = 0xA0, smart quotes, etc.) and declares the encoding only in
// a `<meta http-equiv=Content-Type content="text/html; charset=windows-1252">`
// tag — the HTTP Content-Type header itself omits the charset. The default
// `response.text()` decodes as UTF-8 and silently turns each high byte into
// U+FFFD ("With the men on a Monday night� - 4pm" — #1506). Detect the
// charset from header → meta → fallback to windows-1252.
const META_CHARSET_RE = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i;
const CONTENT_TYPE_CHARSET_RE = /charset\s*=\s*"?([\w-]+)"?/i;
const FALLBACK_CHARSET = "windows-1252";

// Cap on the response body we'll buffer into memory. The live source is
// ~56KB; 2MB leaves plenty of headroom for growth while bounding the worst
// case if the upstream ever serves a malformed or hostile payload.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function detectCharset(bytes: Uint8Array, contentType: string | null): string {
  if (contentType) {
    const m = CONTENT_TYPE_CHARSET_RE.exec(contentType);
    if (m) return m[1].toLowerCase();
  }
  // Scan the first ~2KB for a <meta charset> declaration. UTF-8 is ASCII-
  // compatible (and the WHATWG-recommended label), so it safely decodes
  // any all-ASCII meta-tag prefix even when the body itself isn't UTF-8.
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 2048));
  const m1 = META_CHARSET_RE.exec(head);
  if (m1) return m1[1].toLowerCase();
  return FALLBACK_CHARSET;
}

/** Wrap `new TextDecoder(label)` so a bogus charset (from a malformed
 *  meta tag) falls back to windows-1252 with a warning instead of
 *  throwing RangeError and killing the scrape. */
function makeDecoder(label: string): TextDecoder {
  try {
    return new TextDecoder(label, { fatal: false });
  } catch (err) {
    console.warn(
      `[auckland-hussies] Unsupported charset label "${label}" — falling back to ${FALLBACK_CHARSET}`,
      err,
    );
    return new TextDecoder(FALLBACK_CHARSET, { fatal: false });
  }
}

interface FetchSuccess {
  ok: true;
  $: cheerio.CheerioAPI;
  structureHash: string;
  fetchDurationMs: number;
}
type FetchOutcome = FetchSuccess | { ok: false; result: ScrapeResult };

async function fetchCharsetAwareHTMLPage(url: string): Promise<FetchOutcome> {
  const fetchStart = Date.now();
  try {
    const response = await safeFetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
    });
    if (!response.ok) {
      const message = `HTTP ${response.status}: ${response.statusText}`;
      return {
        ok: false,
        result: {
          events: [],
          errors: [message],
          errorDetails: { fetch: [{ url, status: response.status, message }] },
        },
      };
    }
    // Reject oversized payloads up-front when the server tells us the size.
    // Without this, a hostile/misbehaving origin could push the response
    // arbitrarily large before we ever decode.
    const declaredLength = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      const message = `Response too large: ${declaredLength} bytes > ${MAX_BODY_BYTES} cap`;
      return {
        ok: false,
        result: { events: [], errors: [message], errorDetails: { fetch: [{ url, message }] } },
      };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BODY_BYTES) {
      // Belt-and-suspenders for servers that omit Content-Length.
      const message = `Response too large: ${bytes.byteLength} bytes > ${MAX_BODY_BYTES} cap`;
      return {
        ok: false,
        result: { events: [], errors: [message], errorDetails: { fetch: [{ url, message }] } },
      };
    }
    const charset = detectCharset(bytes, response.headers.get("content-type"));
    const html = makeDecoder(charset).decode(bytes);
    return {
      ok: true,
      $: cheerio.load(html),
      structureHash: generateStructureHash(html),
      fetchDurationMs: Date.now() - fetchStart,
    };
  } catch (err) {
    const message = `Fetch failed: ${err}`;
    return {
      ok: false,
      result: { events: [], errors: [message], errorDetails: { fetch: [{ url, message }] } },
    };
  }
}

/** Drop U+FFFD (only fires if the meta-tag sniff ever picks the wrong
 *  charset) and collapse whitespace runs — including U+00A0 NBSP that
 *  cheerio leaves verbatim — so the saved cell reads as one sentence. */
function cleanCellText(text: string | undefined): string | undefined {
  if (text == null) return undefined;
  const cleaned = text.replaceAll('\uFFFD', '').replace(/\s+/g, ' ').trim();
  return cleaned || undefined;
}

// ---------------------------------------------------------------------------
// Location-cell classifier (#1516)
//
// Source rows occasionally put non-address content in the location column:
//
//   "With the men on a Monday night - 4pm"     (pure annotation: joint-run note)
//   "3pm 5 Olsen Ave, Mangawhai Heads"         (per-event start-time prefix + address)
//   "With the men on a Monday night - 4pm  6 Waterstone Way, Henderson"
//                                              (annotation + address on one line)
//
// Pre-WS6 the whole cell was stored verbatim as `location`, so the Hareline
// rendered "Monday night - 4pm" as the venue. Classify the cell so a leading
// bare-time prefix lifts into `startTime`, a "With the men/women/\u2026" joint-run
// prefix routes to `description`, and any trailing address-shaped substring is
// recovered as the location. Pure venue names ("The Bond Sports Bar") fall
// through unchanged.
// ---------------------------------------------------------------------------

const TIME_PREFIX_RE = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b\s*[-\u2013\u2014]?\s*/i;
const JOINT_RUN_NOTE_RE = /^with\s+(?:the\s+)?(?:men|women|girls|guys|boys|joint|other)\b/i;
// "12 Foo St", "6 Waterstone Way, Henderson", "111 Walker Rd, Pt Chevalier",
// "1/23 Main St" (NZ unit prefix), "84A Church St" (letter suffix). The
// street-number head accepts an optional unit/range prefix and a single
// letter suffix; the tail allows `St.` / `Rd.` abbreviations with a period.
// A separate street-suffix gate (below) keeps a stray "4pm 6th" from being
// mistaken for an address.
// NOSONAR S5843 \u2014 complexity is intrinsic to the address grammar (street-
// number head + Capitalised-word chain + optional comma-separated suburb).
// Splitting further loses readability without lowering ReDoS risk; the regex
// is anchored at end-of-string with no overlapping alternations.
const ADDRESS_TAIL_RE = // NOSONAR S5843
  /\b(\d+(?:[/-]\d+)?[A-Za-z]?\s+[A-Z][\w'\-.]*(?:\s+[A-Z][\w'\-.]*)*(?:,\s*[A-Za-z][\w'\-.]*(?:\s+[A-Za-z][\w'\-.]*)*)*)\s*$/;
// NZ street/place suffixes. Built dynamically so Sonar's S5843 regex-
// complexity analyser sees a runtime string rather than a 24-branch literal
// alternation (the literal would land at complexity 64, well over the 20
// threshold). Long-form words (Street/Road/Way/Park/...) and abbreviated
// forms (St/Rd/Ave/Tce/...) all accept an optional trailing period via a
// single shared `\.?` \u2014 Sonar prefers `?` over `*` for an optional single
// char (gemini-code-assist comment on PR #1597).
const STREET_SUFFIX_TOKENS = [
  "Street", "St", "Road", "Rd", "Avenue", "Ave", "Lane", "Ln",
  "Drive", "Dr", "Place", "Pl", "Way", "Heads", "Bay", "Park",
  "Crescent", "Cres", "Terrace", "Tce", "Highway", "Hwy", "Boulevard",
  "Blvd", "Court", "Ct", "Close", "Cl", "Quay", "Wharf", "Grove",
  "Rise", "Row", "View", "Walk", "Parade", "Esplanade", "Point", "Pt",
];
const STREET_SUFFIX_RE = new RegExp(
  `\\b(?:${STREET_SUFFIX_TOKENS.join("|")})\\.?\\b`,
  "i",
);

export interface ClassifiedLocationCell {
  /**
   * `undefined` = no signal (preserve any existing `locationName`).
   * `null` = explicit clear — emitted when the cell turned out to be an
   * annotation rather than a venue, so the merge pipeline overwrites stale
   * `locationName` from earlier scrapes (#1516).
   */
  location?: string | null;
  description?: string;
  startTime?: string;
}

/** Set of characters considered trailing "note separator" runs — whitespace
 *  plus the ASCII hyphen and the two unicode dashes the source uses. */
const TRAILING_NOTE_SEPARATORS = new Set([" ", "\t", "\n", "\r", "-", "–", "—"]);

function stripTrailingNoteSeparators(s: string): string {
  let end = s.length;
  while (end > 0 && TRAILING_NOTE_SEPARATORS.has(s[end - 1])) end--;
  return s.slice(0, end);
}

/** Convert a bare-time pair (e.g. `3` + `00` + `pm`) into HH:MM. */
function formatBareTime(hours: number, mins: number, ampm: string): string | undefined {
  if (hours > 23 || mins > 59) return undefined;
  let h24 = hours;
  const lower = ampm.toLowerCase();
  if (lower === "pm" && h24 !== 12) h24 += 12;
  if (lower === "am" && h24 === 12) h24 = 0;
  if (h24 > 23) return undefined;
  return `${String(h24).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/**
 * Classify a location-cell value into venue vs annotation vs time prefix.
 * Closes #1516. See block comment above for the patterns covered.
 */
export function classifyLocationCell(text: string | undefined): ClassifiedLocationCell {
  if (text == null) return {};
  let cleaned = text.trim();
  if (!cleaned) return {};

  // 1. Strip a leading bare-time prefix ("3pm 5 Olsen Ave\u2026") into startTime.
  let startTime: string | undefined;
  const tMatch = TIME_PREFIX_RE.exec(cleaned);
  if (tMatch) {
    const hh = Number.parseInt(tMatch[1], 10);
    const mm = tMatch[2] ? Number.parseInt(tMatch[2], 10) : 0;
    const formatted = formatBareTime(hh, mm, tMatch[3]);
    if (formatted) {
      startTime = formatted;
      cleaned = cleaned.slice(tMatch[0].length).trim();
    }
  }
  if (!cleaned) return { startTime };

  // 2. Joint-run annotation prefix routes prose to `description`. When the
  //    annotation also carries a trailing street address, peel it back into
  //    `location`. Otherwise emit `location: null` so the merge pipeline
  //    scrubs any stale `locationName` from earlier scrapes (#1516 cycle-9
  //    escape \u2014 Codex adversarial review caught the undefined-preserves
  //    pitfall).
  if (JOINT_RUN_NOTE_RE.test(cleaned)) {
    const addrMatch = ADDRESS_TAIL_RE.exec(cleaned);
    if (addrMatch && STREET_SUFFIX_RE.test(addrMatch[1])) {
      const addr = addrMatch[1].trim();
      // Strip trailing whitespace + dash separators (`- `, `\u2013 `, `\u2014`) from the
      // note half. Procedural strip avoids the `[\s\-\u2013\u2014]+$` regex shape that
      // Sonar S5852 flags as ReDoS even though it's linear (see memory:
      // feedback_sonar_s5852_false_positives).
      const note = stripTrailingNoteSeparators(cleaned.slice(0, addrMatch.index)).trim();
      return { location: addr, description: note || undefined, startTime };
    }
    return { location: null, description: cleaned, startTime };
  }

  // 3. Default: treat the cell as a venue/location name (current behaviour).
  return { location: cleaned, startTime };
}

export interface AucklandHussiesParsedRow {
  dateText: string;
  hareText?: string;
  locationText?: string;
}

/** Type-guard for the kennelTag-bearing source config. */
interface AucklandHussiesConfig {
  kennelTag: string;
}
function isAucklandHussiesConfig(cfg: unknown): cfg is AucklandHussiesConfig {
  return typeof cfg === "object" && cfg !== null && typeof (cfg as { kennelTag?: unknown }).kennelTag === "string";
}

/**
 * Convert one parsed row to RawEventData. Returns null for placeholder /
 * unparseable dates.
 *
 * Year inference uses refDate-year by default; supply `prevDate` to bump
 * forward when the chronologically-sorted run list rolls past a year
 * boundary.
 */
export function parseAucklandHussiesRow(
  row: AucklandHussiesParsedRow,
  opts: { kennelTag: string; sourceUrl: string; referenceDate?: Date; prevDate?: string },
): RawEventData | null {
  const parsed = chronoParseDate(
    row.dateText,
    "en-GB",
    opts.referenceDate,
    { forwardDate: false },
  );
  if (!parsed) return null;
  const date = bumpYearIfBefore(parsed, opts.prevDate);

  const hares = normalizeHaresField(stripPlaceholder(row.hareText));
  // Cheerio decodes &nbsp; to U+00A0, which String#trim already strips, so
  // `stripPlaceholder` cleanly drops cells that hold nothing but &nbsp;.
  // Then route the residual through classifyLocationCell so per-event time
  // prefixes and joint-run annotations don't masquerade as the venue (#1516).
  const stripped = stripPlaceholder(row.locationText);
  const { location, description, startTime } = classifyLocationCell(stripped);

  return {
    date,
    kennelTags: [opts.kennelTag],
    hares,
    location,
    description,
    startTime,
    sourceUrl: opts.sourceUrl,
  };
}

/** Read the row's `<td>` text contents once. Callers reuse the array for
 *  both date-row detection and col-4 continuation extraction (gemini-code-
 *  assist review on PR #1597 — avoids redundant DOM traversal per row). */
function readRowCells($: cheerio.CheerioAPI, rowEl: AnyNode): string[] {
  return $(rowEl).find("td").toArray().map((td) => $(td).text());
}

/**
 * Parse a single `<tr>` into date-bearing cells. Returns null if the row
 * isn't a date-shaped run row (annotation / phone / cost / blank). Lifted
 * out of {@link AucklandHussiesAdapter.fetch} for SonarCloud's cognitive-
 * complexity threshold. Accepts pre-extracted `cells` so callers can share
 * the array with continuation-row detection.
 */
function parseRunRowFromCells(
  cells: string[],
): { dateText: string; hareText?: string; locationText?: string } | null {
  if (cells.length < 5) return null;
  const dateCell = cells.at(0)?.trim() ?? "";
  if (!DATE_CELL_RE.test(dateCell)) return null;
  return {
    dateText: dateCell,
    hareText: cleanCellText(cells.at(3)),
    locationText: cleanCellText(cells.at(4)),
  };
}

/**
 * Read col-4 content from a "continuation" `<tr>` — rows where col 0 is
 * blank/empty so the Excel export visually wraps the previous date row's
 * cell. Joint-run rows often put the real street address on the
 * continuation line and the note on the dated line ("With the men on a
 * Monday night - 4pm" → next row → "6 Waterstone Way, Henderson"). Returns
 * `undefined` if the row is itself a date row or lacks col 4.
 */
function continuationLocationFromCells(cells: string[]): string | undefined {
  if (cells.length < 5) return undefined;
  const dateCell = cells.at(0)?.trim() ?? "";
  if (DATE_CELL_RE.test(dateCell)) return undefined;
  return cleanCellText(cells.at(4));
}

/**
 * For joint-run annotation rows, peek up to N follow-on blank-date rows and
 * concatenate their col-4 text into the location string. The classifier's
 * ADDRESS_TAIL_RE peel-back then extracts the street address. For non-
 * annotation rows (normal venue names), this is a no-op — merging would pull
 * in phone/cost/CTA noise (Codex round-2 finding on #1516). Cells are read
 * once per row and threaded through both predicates (gemini-code-assist).
 */
function mergeContinuationRows(
  $: cheerio.CheerioAPI,
  rows: AnyNode[],
  i: number,
  parsedCells: { dateText: string; hareText?: string; locationText?: string },
): { dateText: string; hareText?: string; locationText?: string } {
  if (!parsedCells.locationText || !JOINT_RUN_NOTE_RE.test(parsedCells.locationText)) {
    return parsedCells;
  }
  const CONTINUATION_LOOKAHEAD = 3;
  for (let j = 1; j <= CONTINUATION_LOOKAHEAD && i + j < rows.length; j++) {
    const peek = rows.at(i + j);
    if (!peek) break;
    const peekCells = readRowCells($, peek);
    if (parseRunRowFromCells(peekCells)) break;
    const tail = continuationLocationFromCells(peekCells);
    // Only fold the continuation row in when it actually looks like an
    // address (digit + Capitalised word + recognised street suffix). Pure
    // CTA / phone-number / catering-note continuations stay outside the
    // event payload so the joint-run description doesn't bloat.
    if (tail && ADDRESS_TAIL_RE.test(tail) && STREET_SUFFIX_RE.test(tail)) {
      return { ...parsedCells, locationText: `${parsedCells.locationText} ${tail}` };
    }
  }
  return parsedCells;
}

export class AucklandHussiesAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const sourceUrl = source.url || "https://aucklandhussies.co.nz/Run%20List.html";
    if (!isAucklandHussiesConfig(source.config)) {
      return {
        events: [],
        errors: ["AucklandHussiesAdapter requires config.kennelTag"],
        errorDetails: { fetch: [{ url: sourceUrl, message: "Missing kennelTag in source.config" }] },
      };
    }
    const { kennelTag } = source.config;

    const page = await fetchCharsetAwareHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const parseErrors: NonNullable<ErrorDetails["parse"]> = [];
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 180);

    // Excel-exported tables don't have semantic <th>; iterate all rows
    // and rely on the date-shape discriminator in column 0. Joint-run rows
    // often place the actual street address on a follow-on row with a blank
    // date cell (Codex #1516 round 2) — walk forward and concatenate that
    // text into the current row's locationText so the classifier's address-
    // tail peel-back can recover the venue.
    const rows = $("tr").toArray();
    let rowsConsidered = 0;
    let prevDate: string | undefined;
    for (let i = 0; i < rows.length; i++) {
      const row = rows.at(i);
      if (!row) continue;
      const cells = readRowCells($, row);
      const parsedCells = parseRunRowFromCells(cells);
      if (!parsedCells) continue;
      rowsConsidered += 1;

      // For joint-run annotation rows ("With the men on a Monday night - 4pm"),
      // the real street address often sits on the next blank-date row. Merge
      // those continuation rows in so the classifier's address-tail peel-back
      // can recover the venue. For normal rows whose location cell already
      // looks like a venue, do NOT merge — the continuation rows in that case
      // are cost / phone-number / CTA noise that would pollute the address.
      const cellsWithMerged = mergeContinuationRows($, rows, i, parsedCells);

      try {
        const event = parseAucklandHussiesRow(cellsWithMerged, { kennelTag, sourceUrl, prevDate });
        if (!event) continue;
        prevDate = event.date;
        const eventDate = new Date(`${event.date}T12:00:00Z`);
        if (eventDate < minDate || eventDate > maxDate) continue;
        events.push(event);
      } catch (err) {
        errors.push(`Row ${i}: ${err}`);
        parseErrors.push({
          row: i,
          section: "run-list",
          error: String(err),
          rawText: $(row).text().trim().slice(0, 500),
        });
      }
    }

    if (parseErrors.length > 0) errorDetails.parse = parseErrors;

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        rowsConsidered,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
