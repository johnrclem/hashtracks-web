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
  const location = stripPlaceholder(row.locationText);

  return {
    date,
    kennelTags: [opts.kennelTag],
    hares,
    location,
    sourceUrl: opts.sourceUrl,
  };
}

/**
 * Extract the date-bearing cells from a single `<tr>`. Returns null if the
 * row isn't a date-shaped run row (annotation / phone / cost / blank).
 * Lifted out of {@link AucklandHussiesAdapter.fetch} purely to keep that
 * method below SonarCloud's cognitive-complexity threshold.
 */
function extractRunRowCells(
  $: cheerio.CheerioAPI,
  rowEl: AnyNode,
): { dateText: string; hareText?: string; locationText?: string } | null {
  const cells = $(rowEl).find("td").toArray().map((td) => $(td).text());
  if (cells.length < 5) return null;
  const dateCell = cells.at(0)?.trim() ?? "";
  if (!DATE_CELL_RE.test(dateCell)) return null;
  return {
    dateText: dateCell,
    hareText: cleanCellText(cells.at(3)),
    locationText: cleanCellText(cells.at(4)),
  };
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
    // and rely on the date-shape discriminator in column 0.
    const rows = $("tr").toArray();
    let rowsConsidered = 0;
    let prevDate: string | undefined;
    for (let i = 0; i < rows.length; i++) {
      const row = rows.at(i);
      if (!row) continue;
      const parsedCells = extractRunRowCells($, row);
      if (!parsedCells) continue;
      rowsConsidered += 1;

      try {
        const event = parseAucklandHussiesRow(parsedCells, { kennelTag, sourceUrl, prevDate });
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
