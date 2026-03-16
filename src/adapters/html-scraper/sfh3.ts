import * as cheerio from "cheerio";
import type { Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, chronoParseDate, parse12HourTime } from "../utils";
import { parseICalSummary } from "../ical/adapter";

/** Config shape — reuses same kennelPatterns/skipPatterns as iCal adapter */
export interface SFH3ScraperConfig {
  kennelPatterns?: [string, string][];
  defaultKennelTag?: string;
  skipPatterns?: string[];
}

/** Parsed row from the SFH3 hareline table */
export interface HarelineRow {
  kennelTag?: string;
  runNumber?: number;
  dateText: string;
  hare?: string;
  locationText?: string;
  locationUrl?: string;
  title: string;
  detailUrl?: string;
}

/**
 * Parse a date from the SFH3 hareline "When" column.
 *
 * Expected formats from the MultiHash platform:
 *   Old: "Monday 3/3/2026" or "3/3/2026" or "03/03/2026"
 *   New: "Mon, Mar 16, 6:15 pm"
 */
export function parseSFH3Date(dateText: string): string | null {
  // Try old numeric format first: M/D/YYYY or MM/DD/YYYY
  const numericMatch = dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (numericMatch) {
    const month = parseInt(numericMatch[1], 10);
    const day = parseInt(numericMatch[2], 10);
    const year = parseInt(numericMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    // Numeric pattern found but invalid — don't fall through to chrono
    return null;
  }

  // New format: "Mon, Mar 16, 6:15 pm" — use chrono-node
  return chronoParseDate(dateText, "en-US") ?? null;
}

/**
 * Extract a Google Maps URL from a location cell's HTML.
 * The "Where" column typically wraps the location name in a Google Maps link.
 */
export function extractLocationUrl(locationHtml: string): string | undefined {
  const $ = cheerio.load(locationHtml);
  const href = $("a").attr("href");
  if (href && /maps\.google|google\.\w+\/maps|goo\.gl\/maps/i.test(href)) {
    return href;
  }
  return undefined;
}

/**
 * Parse all hareline rows from the SFH3 runs page HTML.
 *
 * The MultiHash platform serves a table with columns:
 *   Old (5-col): Run# | When | Hare | Where | What
 *   New (7-col): Kennel | R*n | When | Hare | Where | What | Misinformation
 *
 * The Run# column may contain a link to /runs/{id} with "#NNN" text.
 * The Where column may contain a Google Maps link.
 */
export function parseHarelineRows(html: string): HarelineRow[] {
  const $ = cheerio.load(html);
  const rows: HarelineRow[] = [];

  // Find the main runs table
  const table = $("table").first();
  if (!table.length) return rows;

  // Detect column layout from header row
  const headerCells = table.find("th");
  const is7Col = headerCells.length >= 7 ||
    headerCells.toArray().some((th) => $(th).text().trim().toLowerCase() === "kennel");

  const bodyRows = table.find("tbody tr");
  const targetRows = bodyRows.length > 0 ? bodyRows : table.find("tr").slice(1);

  targetRows.each((_i, el) => {
    const $row = $(el);
    const cells = $row.find("td");
    if (cells.length < 5) return;

    let kennelTag: string | undefined;
    let runNumber: number | undefined;
    let detailLink: string | undefined;
    let dateText: string;
    let hare: string | undefined;
    let locationCell: Cheerio<AnyNode>;
    let title: string;

    if (is7Col && cells.length >= 7) {
      // New layout: Kennel | R*n | When | Hare | Where | What | Misinformation
      kennelTag = cells.eq(0).text().trim() || undefined;

      const runCell = cells.eq(1);
      const runText = runCell.text().trim().replace(/^#/, "");
      runNumber = runText ? parseInt(runText, 10) : undefined;
      detailLink = runCell.find("a").attr("href") || undefined;

      dateText = cells.eq(2).text().trim();
      hare = cells.eq(3).text().trim() || undefined;
      locationCell = cells.eq(4);
      title = cells.eq(5).text().trim();
    } else {
      // Old layout: Run# | When | Hare | Where | What
      const runCell = cells.eq(0);
      const runNumText = runCell.text().trim();
      runNumber = runNumText ? parseInt(runNumText, 10) : undefined;
      detailLink = runCell.find("a").attr("href") || undefined;

      dateText = cells.eq(1).text().trim();
      hare = cells.eq(2).text().trim() || undefined;
      locationCell = cells.eq(3);
      title = cells.eq(4).text().trim();
    }

    const locationText = locationCell.text().trim() || undefined;
    const locationUrl = extractLocationUrl(locationCell.html() || "");

    if (!dateText) return;

    rows.push({
      kennelTag,
      runNumber: runNumber && !isNaN(runNumber) ? runNumber : undefined,
      dateText,
      hare,
      locationText,
      locationUrl,
      title,
      detailUrl: detailLink,
    });
  });

  return rows;
}

/**
 * SFH3 MultiHash HTML Scraper
 *
 * Scrapes sfh3.com/runs?kennels=all for upcoming runs. The page is a static HTML
 * table (Run# | When | Hare | Where | What) served by the MultiHash platform
 * (Q Laboratories). This is a secondary/enrichment source — the primary source
 * is the SFH3 iCal feed which uses the same backend data.
 *
 * The "What" column uses the same kennel-prefixed format as the iCal SUMMARY field
 * (e.g., "SFH3 #2302: A Very Heated Rivalry"), so we reuse parseICalSummary()
 * for kennel tag extraction.
 */
export class SFH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://www.sfh3.com/runs?kennels=all";
    const config = (source.config as SFH3ScraperConfig | null) ?? {};
    const { kennelPatterns, defaultKennelTag } = config;
    const skipPatterns = config.skipPatterns?.map((p) => new RegExp(p, "i"));

    const page = await fetchHTMLPage(baseUrl);
    if (!page.ok) return page.result;
    const { html, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const rows = parseHarelineRows(html);
    let skippedPattern = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        // Skip rows matching skipPatterns (e.g., "Hand Pump", "Workday")
        const fullTitle = row.kennelTag && row.title
          ? `${row.kennelTag}: ${row.title}`
          : row.title;
        if (skipPatterns?.some((p) => p.test(fullTitle))) {
          skippedPattern++;
          continue;
        }

        const date = parseSFH3Date(row.dateText);
        if (!date) {
          errorDetails.parse = [
            ...(errorDetails.parse ?? []),
            { row: i, section: "hareline", field: "date", error: `Could not parse date: "${row.dateText}"`, rawText: `Date: ${row.dateText} | Title: ${row.title} | Location: ${row.locationText ?? ""} | Hare: ${row.hare ?? ""}`.slice(0, 2000) },
          ];
          continue;
        }

        // Extract kennel tag from dedicated column (new layout) or title (old layout)
        const parsed = parseICalSummary(row.title, kennelPatterns, defaultKennelTag);
        const kennelTag = row.kennelTag ?? parsed.kennelTag;

        // Prefer run number from dedicated column, fall back to title
        const runNumber = row.runNumber ?? parsed.runNumber;

        // Extract start time from the date column (new format: "Mon, Mar 16, 6:15 pm")
        const startTime = parse12HourTime(row.dateText);

        // Build the detail page URL
        const detailUrl = row.detailUrl
          ? new URL(row.detailUrl, "https://www.sfh3.com").href
          : undefined;

        events.push({
          date,
          kennelTag,
          runNumber,
          title: parsed.title ?? row.title,
          hares: row.hare,
          location: row.locationText,
          locationUrl: row.locationUrl,
          startTime,
          sourceUrl: detailUrl ?? baseUrl,
        });
      } catch (err) {
        errors.push(`Error parsing row ${i}: ${err}`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          { row: i, section: "hareline", error: String(err), rawText: `Date: ${row.dateText} | Title: ${row.title} | Location: ${row.locationText ?? ""} | Hare: ${row.hare ?? ""}`.slice(0, 2000) },
        ];
      }
    }

    const hasErrorDetails = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        rowsFound: rows.length,
        eventsParsed: events.length,
        skippedPattern,
        fetchDurationMs,
      },
    };
  }
}
