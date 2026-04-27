/**
 * Copenhagen Howling H3 (CH4) — HTML scraper for ch4.dk runsheet.
 *
 * The site is a hand-edited static HTML page. The runsheet for the current
 * year lives in a `<table border="1" cellpadding="5">` immediately after a
 * `<h2>Runsheet YYYY</h2>` heading. Each row has 6 cells:
 *   [0] "CH4 #N"           [1] "Friday DD-MM-YYYY  20:00 hrs"
 *   [2] venue + address    [3] public transport link (ignored)
 *   [4] hares              [5] notes (often "Full Moon Hash")
 *
 * Past runs are kept in the source as `<!--- ... -->` HTML comments which
 * Cheerio strips automatically — only the current-year visible runs reach
 * the parser. Placeholder values ("Location TBA", "HARES WANTED ...") are
 * dropped so the merge pipeline can fill them from the GCal source if it
 * has better data.
 */

import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails, ParseError } from "../types";
import { hasAnyErrors } from "../types";
import {
  fetchHTMLPage,
  buildDateWindow,
  normalizeHaresField,
  decodeEntities,
  isPlaceholder,
  stripHtmlTags,
} from "../utils";

// `[^\d]{0,40}` is bounded + greedy: bounded length defends against
// catastrophic backtracking (S5852); greedy is safe because `(\d{1,2}):` next
// requires a digit, so the engine cannot over-consume.
// NOSONAR — bounded length + non-overlapping next token rules out super-linear backtracking.
const RE_DATE_TIME = /(\d{1,2})-(\d{1,2})-(\d{4})[^\d]{0,40}(\d{1,2}):(\d{2})/; // NOSONAR
const RE_DATE_ONLY = /(\d{1,2})-(\d{1,2})-(\d{4})/;
const RE_DATE_PARTIAL = /(\d{1,2})-(\d{1,2})(?!\d)/;
const RE_TIME = /(\d{1,2}):(\d{2})/;
const RE_HARES_RECRUITMENT = /hares?\s+wanted|contact\s+the\s+ch4\s+junta|junta/i;
const RE_HARES_WANTED = /hares?\s+wanted/i;
const RE_HARES_SPLIT = /\s+and\s+|\s*&\s*|\s*,\s*/i;
const RE_RUN_NUMBER = /#\s*(\d+)/;
const RE_RUNSHEET_HEADING = /Runsheet\s+(\d{4})/i;
const RE_LOCATION_TBA = /^location\s+(tba|tbc|tbd)\b/i;
const RE_INTERNAL_LINK = /^(?:mailto:|tel:|#)/i;
const RE_DOUBLE_COMMA = /,\s*,/g;
const RE_LEADING_TRAILING_COMMA = /^\s*,|,\s*$/g;
const RE_WHITESPACE_RUN = /\s+/g;

interface ParsedDateTime {
  date: string;
  startTime?: string;
}

function parseFullDateTime(text: string): ParsedDateTime | null {
  const m = RE_DATE_TIME.exec(text);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mins] = m;
  const day = Number.parseInt(dd, 10);
  const month = Number.parseInt(mm, 10);
  const year = Number.parseInt(yyyy, 10);
  if (!isValidDate(year, month, day)) return null;
  return {
    date: formatYmd(year, month, day),
    startTime: formatHm(Number.parseInt(hh, 10), Number.parseInt(mins, 10)),
  };
}

function parseDateOnly(text: string): ParsedDateTime | null {
  const m = RE_DATE_ONLY.exec(text);
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const year = Number.parseInt(m[3], 10);
  if (!isValidDate(year, month, day)) return null;
  return { date: formatYmd(year, month, day) };
}

function parsePartialDate(text: string, yearHint: number): ParsedDateTime | null {
  const m = RE_DATE_PARTIAL.exec(text);
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  if (!isValidDate(yearHint, month, day)) return null;
  const date = formatYmd(yearHint, month, day);
  const timeMatch = RE_TIME.exec(text);
  if (!timeMatch) return { date };
  const startTime = formatHm(
    Number.parseInt(timeMatch[1], 10),
    Number.parseInt(timeMatch[2], 10),
  );
  return startTime ? { date, startTime } : { date };
}

/**
 * Parse cell 1 ("Friday 03-04-2026<br>20:00 hrs") into a YYYY-MM-DD date and
 * HH:MM time. The site uses Danish DD-MM-YYYY ordering. Returns null if no
 * date is found. The optional `yearHint` from the runsheet heading is used
 * only when the inline date omits the year (rare but possible).
 */
export function parseCh4DateTime(
  cellHtml: string,
  yearHint: number | undefined,
): ParsedDateTime | null {
  const text = decodeEntities(stripHtmlTags(cellHtml, " "));
  return (
    parseFullDateTime(text) ??
    parseDateOnly(text) ??
    (yearHint ? parsePartialDate(text, yearHint) : null)
  );
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (year < 1990 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  // Round-trip through Date.UTC to reject impossible combinations like
  // 31-04 (April has 30 days) or 29-02 in non-leap years. JS Date silently
  // rolls invalid days into the next month, so we compare back to the input.
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

function formatYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function formatHm(h: number, m: number): string | undefined {
  if (h < 0 || h > 23 || m < 0 || m > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function appendParseError(errorDetails: ErrorDetails, error: ParseError): void {
  errorDetails.parse ??= [];
  errorDetails.parse.push(error);
}

/**
 * Flatten a multi-line address cell — venues use `<br>` between
 * "Cafe Ellebo / Sjælør Boulevard 49 / 2450 Copenhagen SV". We normalize
 * to ", "-separated so it lands cleanly in the location field.
 */
export function flattenAddressCell(cellHtml: string): string | undefined {
  const text = decodeEntities(stripHtmlTags(cellHtml, ", "));
  const cleaned = text
    .replaceAll(RE_DOUBLE_COMMA, ",")
    .replaceAll(RE_LEADING_TRAILING_COMMA, "")
    .trim();
  if (!cleaned) return undefined;
  if (RE_LOCATION_TBA.test(cleaned)) return undefined;
  if (isPlaceholder(cleaned)) return undefined;
  return cleaned;
}

/**
 * Parse a hares cell. "HARES WANTED Contact the CH4 Junta" and similar
 * recruitment placeholders are dropped. Multiple hares (separated by " and "
 * or ", " or " & ") are sorted alphabetically before joining for stable
 * fingerprints.
 */
export function parseCh4Hares(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  if (RE_HARES_RECRUITMENT.test(text)) return undefined;
  if (isPlaceholder(text)) return undefined;
  const parts = text
    .split(RE_HARES_SPLIT)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !RE_HARES_WANTED.test(s));
  if (parts.length === 0) return undefined;
  return normalizeHaresField(parts.join(", "));
}

export class Ch4DkAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const sourceUrl = source.url || "https://ch4.dk/";

    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 365);

    // Locate the runsheet heading — captures the canonical year.
    let yearHint: number | undefined;
    let runsheetTable: ReturnType<typeof $> | null = null;
    $("h2").each((_, el) => {
      if (runsheetTable) return;
      const txt = $(el).text();
      const m = RE_RUNSHEET_HEADING.exec(txt);
      if (!m) return;
      yearHint = Number.parseInt(m[1], 10);
      const $next = $(el).nextAll("table").first();
      if ($next.length) runsheetTable = $next;
    });

    if (!runsheetTable) {
      const message = "Runsheet table not found";
      errors.push(message);
      appendParseError(errorDetails, {
        row: -1,
        section: "runsheet",
        error: "no <h2>Runsheet YYYY</h2> followed by <table> in document",
      });
      return {
        events: [],
        errors,
        structureHash,
        errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
        diagnosticContext: { rowsFound: 0, eventsParsed: 0, fetchDurationMs },
      };
    }

    const table: ReturnType<typeof $> = runsheetTable;
    const rows = table.find("tr");
    rows.each((i, el) => {
      const $row = $(el);
      // Skip header row
      if ($row.find("th").length > 0) return;

      try {
        const $cells = $row.find("td");
        if ($cells.length < 5) return;

        // Cell 0: "CH4 #367"
        const runText = decodeEntities($cells.eq(0).text()).replaceAll(RE_WHITESPACE_RUN, " ").trim();
        const runMatch = RE_RUN_NUMBER.exec(runText);
        const runNumber = runMatch ? Number.parseInt(runMatch[1], 10) : undefined;

        // Cell 1: date+time
        const dateCellHtml = $cells.eq(1).html() ?? "";
        const dt = parseCh4DateTime(dateCellHtml, yearHint);
        if (!dt) return;

        const eventDate = new Date(`${dt.date}T12:00:00Z`);
        if (eventDate < minDate || eventDate > maxDate) return;

        // Cell 2: location — single cache to avoid two `.eq(2)` traversals.
        const $locCell = $cells.eq(2);
        const location = flattenAddressCell($locCell.html() ?? "");

        let locationUrl: string | undefined;
        $locCell.find("a[href]").each((_idx, a) => {
          if (locationUrl) return;
          const href = $(a).attr("href");
          if (!href || RE_INTERNAL_LINK.test(href)) return;
          locationUrl = href;
        });

        // Cell 4: hares (cell 3 is the public-transport widget)
        const haresText = $cells.eq(4).length
          ? decodeEntities($cells.eq(4).text()).replaceAll(RE_WHITESPACE_RUN, " ").trim()
          : undefined;
        const hares = parseCh4Hares(haresText);

        // Cell 5: notes — strip embedded "Add to Google Calendar" anchor.
        let notes: string | undefined;
        if ($cells.eq(5).length) {
          const $notes = $cells.eq(5).clone();
          $notes.find("a, img").remove();
          const noteText = decodeEntities($notes.text()).replaceAll(RE_WHITESPACE_RUN, " ").trim();
          notes = noteText || undefined;
        }

        events.push({
          date: dt.date,
          kennelTag: "ch4-dk",
          runNumber,
          title: runNumber === undefined ? undefined : `CH4 #${runNumber}`,
          startTime: dt.startTime,
          location,
          locationUrl,
          hares,
          description: notes,
          sourceUrl,
        });
      } catch (err) {
        errors.push(`Error parsing row ${i}: ${err}`);
        appendParseError(errorDetails, {
          row: i,
          section: "runsheet",
          error: String(err),
          // Don't echo row text — runsheet cells include hares names (PII).
        });
      }
    });

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        runsheetYear: yearHint ?? null,
        rowsFound: rows.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
