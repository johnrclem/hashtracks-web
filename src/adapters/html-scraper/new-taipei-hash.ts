import * as cheerio from "cheerio";
import type { CheerioAPI, Cheerio } from "cheerio";
import type { Element } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
  ParseError,
} from "../types";
import { hasAnyErrors } from "../types";
import { filterEventsByWindow, normalizeHaresField } from "../utils";
import { safeFetch } from "../safe-fetch";
import { generateStructureHash } from "@/pipeline/structure-hash";

/**
 * New Taipei Hash House Harriers (新北捷兔) — `nth3-tw`.
 *
 * Static Cheerio scrape of the kennel's legacy server-rendered yearly page at
 * newtaipeihash.com/run_site_<YYYY>.htm. A single `<table>` holds the whole
 * year's hareline (past + future) plus highlighted "Important Events" specials.
 *
 * Three source-specific quirks drive a bespoke adapter (vs config-only):
 *   1. **Big5 encoding.** The page declares no charset and serves legacy Big5
 *      bytes — `response.text()` (UTF-8) mojibakes every Chinese venue/hare.
 *      We read the raw bytes and decode with `TextDecoder("big5")` before
 *      cheerio.load. This is HashTracks' first Big5 source.
 *   2. **Year is in the URL filename**, not the rows. `run_site_2026.htm` →
 *      2026. The adapter derives the *current* year at fetch time so a daily
 *      scraper never pins to a stale page once the year rolls over.
 *   3. **Seasonal start time, not per-row.** The page header is authoritative:
 *      "下午15:00起跑(冬令時間提前於下午14:30起跑)" — summer 15:00 / winter 14:30.
 *      The in-table season-marker rows actually have a typo (both say 14:30),
 *      so we derive the time by month (Apr–Sep summer / Oct–Mar winter), which
 *      matches the real marker boundaries (winter from run #706=10/04, summer
 *      from run #680=04/05) exactly.
 *
 * Other quirks handled: hare cells carry PII phone numbers (mobile `0xxx-xxx-xxx`
 * and landline `(02)xxxx-xxxx`) that are stripped; the Word "Save as HTML" export
 * leaks `<style>` content into some cells (2024+); the highlighted "Important
 * Events" rows duplicate weekly-list runs and are deduped by run number; per-run
 * Facebook event links are captured as EventLinks (not locationUrl, which is
 * reserved for genuine map links so the static-map click-through stays a map).
 */

const KENNEL_TAG = "nth3-tw";
const DEFAULT_BASE = "http://www.newtaipeihash.com";
const NOON_HOUR = 12;
const SUMMER_START = "15:00"; // Apr–Sep
const WINTER_START = "14:30"; // Oct–Mar
const SUMMER_MONTHS = new Set([4, 5, 6, 7, 8, 9]);
const BIG5_LABEL = "big5";

// A `Mozilla`-prefixed UA is mandatory: the origin returns HTTP 500 to a bare
// `curl/*` UA but 200 to any Mozilla UA (verified 2026-06-13).
const USER_AGENT = "Mozilla/5.0 (compatible; HashTracks-Scraper)";

// Cap on the response body we'll buffer. The live 2026 page is ~126KB; 2MB
// leaves headroom while bounding a malformed/hostile payload.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

// First MM/DD in the cell — a trailing `~DD` (multi-day special, e.g. archive
// #46 `11/15~17`) is ignored, so the event lands on the first day.
const DATE_RE = /(\d{1,2})\/(\d{1,2})/;
const RUN_RE = /(\d+)/;

// Phone strips (bounded — ReDoS-safe, no nested unbounded quantifiers):
//   (02)2883-2383  — landline with parenthesised area code
//   0920-946-035   — mobile (also matches 02-2883-2383)
const PHONE_PAREN_RE = /\(0\d\)\d{3,4}-?\d{3,4}/g;
const PHONE_DASHED_RE = /0\d{1,3}-?\d{3,4}-?\d{3,4}/g;

// Distinct hares are separated by & / ＆ / 、 ; a single hare's CN/EN names are
// joined by "/" and must stay together. No surrounding `\s*` (S5852/ReDoS) —
// normalizeHaresField trims each comma-split part anyway.
const HARE_SEPARATOR_RE = /[&＆、]/g;

const MAPS_HREF =
  "a[href*='maps.app.goo.gl'], a[href*='goo.gl/maps'], a[href*='google.com/maps']";
const MAPS_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "google.com",
  "www.google.com",
  "maps.google.com",
]);
const FB_HREF = "a[href*='fb.me/'], a[href*='facebook.com/events/']";
const FB_HOSTS = new Set(["fb.me", "facebook.com", "www.facebook.com", "m.facebook.com"]);

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Round-trip-validated UTC-noon ms for a given Y/M/D, or null if impossible. */
function utcNoonMs(year: number, month: number, day: number): number | null {
  const ms = Date.UTC(year, month - 1, day, NOON_HOUR, 0, 0);
  const d = new Date(ms);
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return ms;
}

/** Summer (Apr–Sep) 15:00, winter (Oct–Mar) 14:30. */
function seasonalStartTime(month: number): string {
  return SUMMER_MONTHS.has(month) ? SUMMER_START : WINTER_START;
}

// Overseas-special venues prefix the country in Chinese (e.g. "泰國 清邁",
// "日本 沖繩"). The merge pipeline drops geocoded results >200km from the
// kennel/region centroid unless `countryOverride` is set, which would throw
// away the (correct) foreign pin. Setting countryOverride="" bypasses that
// guard with no geocode bias — the venue text already names the country.
// Mirrors new-tokyo-katch.ts's overseas handling. Set-membership check (not a
// big alternation regex) to keep clear of Sonar S5843.
const FOREIGN_COUNTRY_TOKENS = [
  "泰國", "日本", "越南", "馬來西亞", "菲律賓", "韓國", "香港",
  "新加坡", "中國", "柬埔寨", "印尼", "寮國", "緬甸",
];
function foreignCountryOverride(location: string | undefined): string | undefined {
  if (!location) return undefined;
  return FOREIGN_COUNTRY_TOKENS.some((t) => location.includes(t)) ? "" : undefined;
}

/** Big5 → string, falling back to UTF-8 only if the runtime lacks Big5. */
export function decodeBig5(bytes: Uint8Array): string {
  try {
    return new TextDecoder(BIG5_LABEL, { fatal: false }).decode(bytes);
  } catch (err) {
    console.warn(
      `[new-taipei-hash] TextDecoder("${BIG5_LABEL}") unavailable — falling back to utf-8`,
      err,
    );
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

/**
 * Collapse a cell to clean text. Strips `<style>`/`<script>` first — the Word
 * "Save as HTML" export leaks `<style><!--td {...}--></style>` into some cells
 * (2024+), and cheerio's `.text()` would otherwise include that CSS. Block
 * boundaries get a trailing space because multi-value cells stack siblings
 * (e.g. a 2-day overseas special renders the run cell as
 * `<p>647</p><p>648</p>`, which `.text()` would otherwise mash to "647648").
 */
function cellText($cell: Cheerio<Element>): string {
  const clone = $cell.clone();
  clone.find("style, script").remove();
  clone.find("br").replaceWith(" ");
  clone.find("p, div, li").append(" ");
  return clone.text().replace(/\s+/g, " ").trim();
}

/** True for the repeated column-header row (跑次 / 日期 / …). */
function parseRunNumber(text: string): number | null {
  const m = RUN_RE.exec(text);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isNaN(n) ? null : n;
}

function parseMonthDay(text: string): { month: number; day: number } | null {
  const m = DATE_RE.exec(text);
  if (!m) return null;
  const month = Number.parseInt(m[1], 10);
  const day = Number.parseInt(m[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

/** Hare name(s) with PII phones stripped, normalised for stable fingerprints. */
function parseHares($cell: Cheerio<Element>): string | undefined {
  const stripped = cellText($cell).replace(PHONE_PAREN_RE, " ").replace(PHONE_DASHED_RE, " ");
  // Turn distinct-hare separators into commas so normalizeHaresField can
  // trim/dedupe/sort/rejoin (idempotent ", "-joined output).
  const asComma = stripped.replace(HARE_SEPARATOR_RE, ", ");
  return normalizeHaresField(asComma);
}

/** Genuine Google Maps link (https + allowlisted host), stored verbatim. */
function parseMapsUrl($cell: Cheerio<Element>): string | undefined {
  const href = $cell.find(MAPS_HREF).first().attr("href")?.trim();
  if (!href) return undefined;
  try {
    const u = new URL(href);
    if (u.protocol !== "https:") return undefined;
    return MAPS_HOSTS.has(u.hostname.toLowerCase()) ? href : undefined;
  } catch {
    return undefined;
  }
}

/** Per-run Facebook event link → externalLinks (proper EventLink home). */
function parseFbLink($cell: Cheerio<Element>): string | undefined {
  const href = $cell.find(FB_HREF).first().attr("href")?.trim();
  if (!href) return undefined;
  try {
    const u = new URL(href);
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    return FB_HOSTS.has(u.hostname.toLowerCase()) ? href : undefined;
  } catch {
    return undefined;
  }
}

/** Build the current year's page URL from the source URL's directory. */
export function resolvePageUrl(sourceUrl: string | null | undefined, year: number): string {
  let base = DEFAULT_BASE;
  if (sourceUrl) {
    try {
      const u = new URL(sourceUrl);
      base = `${u.origin}${u.pathname.replace(/\/[^/]*$/, "")}`;
    } catch {
      base = DEFAULT_BASE;
    }
  }
  return `${base}/run_site_${year}.htm`;
}

/**
 * Parse one yearly page into deduped, date-resolved events. Exported so the
 * one-shot historical backfill can reuse it over the archive pages (year taken
 * from each filename).
 */
export function parseNewTaipeiHash(
  $: CheerioAPI,
  sourceUrl: string,
  year: number,
): { events: RawEventData[]; rowsFound: number; errors: string[]; parseErrors: ParseError[] } {
  const errors: string[] = [];
  const parseErrors: ParseError[] = [];
  // Map keyed by run number — the highlighted "Important Events" specials
  // appear *before* the weekly list, so iterating top-to-bottom lets the
  // (richer) weekly row overwrite the special's stub. Last-wins = weekly.
  const byRun = new Map<number, RawEventData>();
  let rowsFound = 0;

  $("table tr").each((i, tr) => {
    const tds = $(tr).children("td");
    if (tds.length < 5) return; // section band / spacer (1-cell rows)

    try {
      const runNumber = parseRunNumber(cellText(tds.eq(0)));
      // A row without a numeric run number is never a real run — it's a repeated
      // column header (跑次 / Run No.), a spacer, or a deliberate cancellation
      // marker (run cell "X", e.g. the COVID "三級疫情取消" / "大雨取消" rows).
      // Skip silently.
      if (runNumber === null) return;
      const md = parseMonthDay(cellText(tds.eq(1)));
      if (md === null || utcNoonMs(year, md.month, md.day) === null) {
        // A *numbered* run with an unparseable date is a genuine anomaly
        // (markup drift) — surface it so we don't undercount silently.
        const message = `Unparseable date for run #${runNumber} (row ${i})`;
        errors.push(message);
        parseErrors.push({
          row: i,
          section: "run_site",
          error: message,
          rawText: $(tr).text().trim().slice(0, 2000),
        });
        return;
      }
      rowsFound++;
      const fbLink = parseFbLink(tds.eq(4));
      const location = cellText(tds.eq(3)) || undefined;
      const countryOverride = foreignCountryOverride(location);
      byRun.set(runNumber, {
        date: `${year}-${pad2(md.month)}-${pad2(md.day)}`,
        kennelTags: [KENNEL_TAG],
        runNumber,
        startTime: seasonalStartTime(md.month),
        hares: parseHares(tds.eq(2)),
        location,
        locationUrl: parseMapsUrl(tds.eq(4)),
        externalLinks: fbLink ? [{ url: fbLink, label: "Facebook Event" }] : undefined,
        // Overseas specials ("日本 沖繩", "泰國 清邁") — bypass merge's 200km
        // centroid guard so the foreign geocode isn't dropped (PR #2186 review).
        ...(countryOverride !== undefined ? { countryOverride } : {}),
        sourceUrl,
      });
    } catch (err) {
      errors.push(`Error parsing row ${i}: ${err}`);
      parseErrors.push({
        row: i,
        section: "run_site",
        error: String(err),
        rawText: $(tr).text().trim().slice(0, 2000),
      });
    }
  });

  const events = [...byRun.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { events, rowsFound, errors, parseErrors };
}

interface Big5FetchSuccess {
  ok: true;
  $: CheerioAPI;
  structureHash: string;
}
type Big5FetchOutcome = Big5FetchSuccess | { ok: false; result: ScrapeResult };

/** Fetch raw bytes and decode Big5 before loading into cheerio. */
export async function fetchBig5Page(url: string): Promise<Big5FetchOutcome> {
  try {
    const response = await safeFetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(30_000),
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
      const message = `Response too large: ${bytes.byteLength} bytes > ${MAX_BODY_BYTES} cap`;
      return {
        ok: false,
        result: { events: [], errors: [message], errorDetails: { fetch: [{ url, message }] } },
      };
    }
    const html = decodeBig5(bytes);
    return { ok: true, $: cheerio.load(html), structureHash: generateStructureHash(html) };
  } catch (err) {
    const message = `Fetch failed: ${err}`;
    return {
      ok: false,
      result: { events: [], errors: [message], errorDetails: { fetch: [{ url, message }] } },
    };
  }
}

export class NewTaipeiHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    // Year lives in the filename — derive the *current* year so a daily scraper
    // doesn't pin to a stale page after the year rolls over.
    const year = new Date().getUTCFullYear();
    const url = resolvePageUrl(source.url, year);

    const page = await fetchBig5Page(url);
    if (!page.ok) return page.result;

    const { events, rowsFound, errors, parseErrors } = parseNewTaipeiHash(page.$, url, year);

    const errorDetails: ErrorDetails = {};
    if (parseErrors.length > 0) errorDetails.parse = parseErrors;

    // Fail loud: a clean fetch yielding zero events is almost certainly Big5/
    // markup drift, not an empty hareline. A brand-new source has a 0 baseline,
    // so the zero-event health alert won't catch it — push an error so the
    // reconciler doesn't treat the empty result as "all runs cancelled".
    if (events.length === 0) {
      const message = `New Taipei Hash: parsed 0 events from ${rowsFound} rows at ${url} (Big5/markup drift?)`;
      errors.push(message);
      errorDetails.parse = [
        ...(errorDetails.parse ?? []),
        { row: -1, section: "run_site", error: message },
      ];
    }

    const windowed = filterEventsByWindow(events, options?.days ?? 365);

    return {
      events: windowed,
      errors,
      structureHash: page.structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: { rowsFound, eventsParsed: windowed.length, pageUrl: url },
    };
  }
}
