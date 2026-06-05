import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import {
  applyDateWindow,
  chronoParseDate,
  decodeEntities,
  extractHashRunNumber,
  fetchHTMLPage,
  normalizeHaresField,
  stripHtmlTags,
} from "../utils";

/**
 * Pattaya Hash House Harriers (PH3) adapter.
 *
 * pattayah3.com/PH3/php/HareLine/HareLine.php is a PHP-generated hareline page.
 * It uses a two-column table where each row has:
 *   - Left cell: "DD Mon YYYY - Run NNNN" (date + run number)
 *   - Right cell: labeled fields "Hares:", "Theme:", "On On Bar:", "A-Site:"
 *
 * The table also has month heading rows spanning both columns.
 * Rows needing hares show "Hares Required" in red.
 *
 * Weekly Monday runs at 15:00, departing from Buffalo Bar on 3rd Road.
 */

const KENNEL_TAG = "pattaya-h3";
const DEFAULT_START_TIME = "15:00"; // buses depart at 15:00, circle at 16:00

/** Historical run-reports archive (#1927) — every run #1 (1984) → latest. */
export const PH3_RUN_REPORTS_URL =
  "https://www.pattayah3.com/PH3/php/RunReports/RunReports.php";

/**
 * Split the right-cell text (`<br>` already converted to `\n`) into a
 * label→value map. Both the hareline and run-reports pages render details as
 * one `<strong>Label: </strong>value` line per field, so a line-based parse
 * is robust and avoids a `new RegExp(variable)` (Codacy/ReDoS) construction.
 * First occurrence of each label wins; empty values are skipped.
 */
function parseLabeledLines(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const label = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (value && !fields.has(label)) fields.set(label, value);
  }
  return fields;
}

/**
 * Derive hares from a parsed field map, accepting both the "Hares:" (the only
 * form PH3 emits) and singular "Hare:" labels — matching the optional-`s` the
 * prior `grab("Hares?")` regex allowed — and dropping the "Hares Required"
 * placeholder.
 */
function haresFromFields(fields: Map<string, string>): string | undefined {
  const raw = fields.get("hares") ?? fields.get("hare");
  if (!raw || /Hares?\s*Required/i.test(raw)) return undefined;
  return normalizeHaresField(raw);
}

/**
 * Parse an "A-Site" value into a clean location name + a Google Maps URL from
 * any embedded `(lat, lng, ID: n)` coordinates. Shared by the hareline and the
 * run-reports archive.
 */
function extractASiteLocation(aSiteRaw: string | undefined): {
  location?: string;
  locationUrl?: string;
} {
  if (!aSiteRaw) return {};
  let locationUrl: string | undefined;
  const gpsMatch = /\(([0-9.-]+),\s*([0-9.-]+)/.exec(aSiteRaw);
  if (gpsMatch) {
    locationUrl = `https://www.google.com/maps/search/?api=1&query=${gpsMatch[1]},${gpsMatch[2]}`;
  }
  // `[^)]*` (not `.*?`) keeps the strip linear (Sonar S5852-safe) and `[\d.-]`
  // matches the leading number for southern/western (negative) coordinates too.
  const cleaned = aSiteRaw
    .replace(/A-Site Location Needed/i, "")
    .replace(/\([\d.-]+,[^)]*\)/g, "")
    .trim();
  // The literal placeholder was already removed above, so a non-empty result
  // is a real venue name.
  return { location: cleaned || undefined, locationUrl };
}

/**
 * Assemble a Pattaya `RawEventData` from a parsed field map plus the bits each
 * page derives differently (date, run number, title, description, sourceUrl).
 * Shared by the hareline and run-reports parsers so hares/A-Site/return shape
 * live in one place.
 */
function buildPattayaEvent(opts: {
  date: string;
  runNumber: number | undefined;
  fields: Map<string, string>;
  title?: string;
  description?: string;
  sourceUrl: string;
}): RawEventData {
  const { location, locationUrl } = extractASiteLocation(opts.fields.get("a-site"));
  return {
    date: opts.date,
    kennelTags: [KENNEL_TAG],
    runNumber: opts.runNumber,
    title: opts.title,
    hares: haresFromFields(opts.fields),
    location,
    locationUrl,
    description: opts.description,
    startTime: DEFAULT_START_TIME,
    sourceUrl: opts.sourceUrl,
  };
}

/**
 * Parse a hareline row from the Pattaya H3 page.
 * Left cell contains the date+run, right cell has the labeled details.
 *
 * Exported for unit testing.
 */
export function parsePattayaRow(
  leftText: string,
  rightText: string,
  sourceUrl: string,
): RawEventData | null {
  const left = decodeEntities(leftText).trim();
  const right = decodeEntities(rightText).trim();

  // Parse "DD Mon YYYY - Run NNNN" from left cell
  const runMatch = /Run\s+(\d+)/i.exec(left);
  const runNumber = runMatch ? Number.parseInt(runMatch[1], 10) : undefined;

  // Parse date from left cell — everything before "- Run"
  const datePart = left.replace(/-?\s*Run\s+\d+.*/i, "").trim();
  const date = chronoParseDate(datePart, "en-GB");
  if (!date) return null;

  const fields = parseLabeledLines(right);
  const theme = fields.get("theme");
  const onOnBar = fields.get("on on bar");

  return buildPattayaEvent({
    date,
    runNumber,
    fields,
    title: theme ? `PH3 Run #${runNumber}: ${theme}` : undefined,
    // "On On Bar" is the post-run bar (#1926). No dedicated Event column exists
    // for post-run venues, so fold it into description — mirrors the SDH3
    // "On after → description" precedent (parseEventFields in sdh3.ts).
    description: onOnBar ? `On On Bar: ${onOnBar}` : undefined,
    sourceUrl,
  });
}

/**
 * Parse one run-reports row (#1927 historical backfill). Unlike the hareline,
 * the left cell carries only "DD Month" (no year — that comes from the section
 * heading) plus a `RunReportLkup.php?run_num=N` link, and the right cell uses
 * `Hares:` / `Runners:` / optional `A-Site:` labels. The archive has **no**
 * `Theme:` labels (themes are unlabeled bold lines), so the title is left
 * undefined for the merge pipeline to synthesize. Attendee count is preserved
 * in `description` since there is no dedicated column.
 *
 * Exported for unit testing.
 */
export function parsePattayaRunReportRow(
  leftText: string,
  rightText: string,
  href: string | undefined,
  year: number,
): RawEventData | null {
  const left = decodeEntities(leftText).trim();
  const right = decodeEntities(rightText).trim();

  // The href carries the canonical run number (run_num=N); fall back to the
  // "Run #N" link text via the shared #NNN parser (avoids a bespoke regex).
  const hrefMatch = href ? /run_num=(\d+)/i.exec(href) : null;
  const runNumber = hrefMatch
    ? Number.parseInt(hrefMatch[1], 10)
    : extractHashRunNumber(left);

  // First line is "DD Month"; the year is appended from the section heading.
  const dateLine = left.split("\n")[0].trim();
  const date = chronoParseDate(`${dateLine} ${year}`, "en-GB");
  if (!date) return null;

  const fields = parseLabeledLines(right);
  const runners = fields.get("runners");

  return buildPattayaEvent({
    date,
    runNumber,
    fields,
    // No "Theme:" labels in the archive → title synthesized by the merge pipeline.
    description: runners ? `Runners: ${runners}` : undefined,
    sourceUrl: href ?? PH3_RUN_REPORTS_URL,
  });
}

/**
 * Parse the full run-reports archive page into historical events (#1927).
 * Each year is a `<table>` whose `<thead>` reads "Run Reports For YYYY"; data
 * rows are `<tr class="border_bottom">` with a date+link cell and a details
 * cell. Exported for the one-shot backfill script.
 */
export function parsePattayaRunReports(html: string): RawEventData[] {
  const $ = cheerio.load(html);
  const events: RawEventData[] = [];

  $("div.run_report_background table").each((_i, table) => {
    const $table = $(table);
    const yearMatch = /(\d{4})/.exec($table.find("thead th").first().text());
    if (!yearMatch) return;
    const year = Number.parseInt(yearMatch[1], 10);

    $table.find("tr.border_bottom").each((_j, row) => {
      const cells = $(row).find("td");
      if (cells.length < 2) return;
      const leftText = stripHtmlTags(cells.eq(0).html() ?? "", "\n");
      const rightText = stripHtmlTags(cells.eq(1).html() ?? "", "\n");
      const href = cells.eq(0).find("a").attr("href");
      // Isolate per-row parse failures so one malformed row in the ~2000-run
      // archive can't abort the whole backfill (mirrors the hareline adapter).
      try {
        const event = parsePattayaRunReportRow(leftText, rightText, href, year);
        if (event) events.push(event);
      } catch (err) {
        console.warn(`PattayaH3 run-report row skipped (${year}): ${err}`);
      }
    });
  });

  return events;
}

export class PattayaH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://www.pattayah3.com/PH3/php/HareLine/HareLine.php";

    const page = await fetchHTMLPage(baseUrl);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Parse the hareline table
    const rows = $("table.hareline_run_info tr").toArray();
    let rowsParsed = 0;

    for (let i = 0; i < rows.length; i++) {
      const $row = $(rows[i]);

      // Skip month heading rows (class="hareline_month_heading" or td[colspan])
      if ($row.hasClass("hareline_month_heading") || $row.find("td[colspan]").length > 0) {
        continue;
      }

      const cells = $row.find("td");
      if (cells.length < 2) continue;

      const leftHtml = cells.eq(0).html() ?? "";
      const rightHtml = cells.eq(1).html() ?? "";
      const leftText = stripHtmlTags(leftHtml, "\n");
      const rightText = stripHtmlTags(rightHtml, "\n");

      try {
        const event = parsePattayaRow(leftText, rightText, baseUrl);
        if (event) {
          events.push(event);
        }
      } catch (err) {
        errors.push(`Error parsing row ${i}: ${err}`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          { row: i, section: "hareline", error: String(err), rawText: `${leftText} | ${rightText}`.slice(0, 2000) },
        ];
      }
      rowsParsed++;
    }

    if (events.length === 0 && errors.length === 0) {
      errors.push("PattayaH3: zero events parsed from hareline table");
    }

    const days = options?.days ?? source.scrapeDays ?? 365;
    return applyDateWindow(
      {
        events,
        errors,
        structureHash,
        errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
        diagnosticContext: {
          fetchMethod: "fetchHTMLPage",
          rowsFound: rowsParsed,
          eventsParsed: events.length,
          fetchDurationMs,
        },
      },
      days,
    );
  }
}
