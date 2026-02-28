import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";
import { parseICalSummary } from "../ical/adapter";

/** Config shape — reuses same kennelPatterns/skipPatterns as iCal adapter */
export interface SFH3ScraperConfig {
  kennelPatterns?: [string, string][];
  defaultKennelTag?: string;
  skipPatterns?: string[];
}

/** Parsed row from the SFH3 hareline table */
export interface HarelineRow {
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
 *   "Monday 3/3/2026" or "Mon 3/3/2026"  → "2026-03-03"
 *   "3/3/2026"                            → "2026-03-03"
 *   "03/03/2026"                          → "2026-03-03"
 */
export function parseSFH3Date(dateText: string): string | null {
  // Match M/D/YYYY or MM/DD/YYYY, optionally preceded by day name
  const match = dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;

  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
 *   Run# | When | Hare | Where | What
 *
 * The Run# column may contain a link to /runs/{id}.
 * The Where column may contain a Google Maps link.
 */
export function parseHarelineRows(html: string): HarelineRow[] {
  const $ = cheerio.load(html);
  const rows: HarelineRow[] = [];

  // Find the main runs table — try common patterns
  const table = $("table").first();
  if (!table.length) return rows;

  const bodyRows = table.find("tbody tr");
  const targetRows = bodyRows.length > 0 ? bodyRows : table.find("tr").slice(1);

  targetRows.each((_i, el) => {
    const $row = $(el);
    const cells = $row.find("td");
    if (cells.length < 5) return;

    // Column 0: Run#
    const runCell = cells.eq(0);
    const runNumText = runCell.text().trim();
    const runNumber = runNumText ? parseInt(runNumText, 10) : undefined;
    const detailLink = runCell.find("a").attr("href") || undefined;

    // Column 1: When
    const dateText = cells.eq(1).text().trim();

    // Column 2: Hare
    const hare = cells.eq(2).text().trim() || undefined;

    // Column 3: Where (may contain a Google Maps link)
    const locationCell = cells.eq(3);
    const locationText = locationCell.text().trim() || undefined;
    const locationUrl = extractLocationUrl(locationCell.html() || "");

    // Column 4: What (event title, usually "KENNEL #RUN: Title")
    const title = cells.eq(4).text().trim();

    if (!dateText || !title) return;

    rows.push({
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

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let html: string;
    const fetchStart = Date.now();
    try {
      const response = await fetch(baseUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)",
        },
      });
      if (!response.ok) {
        const message = `HTTP ${response.status}: ${response.statusText}`;
        errorDetails.fetch = [
          { url: baseUrl, status: response.status, message },
        ];
        return { events: [], errors: [message], errorDetails };
      }
      html = await response.text();
    } catch (err) {
      const message = `Fetch failed: ${err}`;
      errorDetails.fetch = [{ url: baseUrl, message }];
      return { events: [], errors: [message], errorDetails };
    }
    const fetchDurationMs = Date.now() - fetchStart;

    const structureHash = generateStructureHash(html);

    const rows = parseHarelineRows(html);
    let skippedPattern = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        // Skip rows matching skipPatterns (e.g., "Hand Pump", "Workday")
        if (skipPatterns?.some((p) => p.test(row.title))) {
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

        // Extract kennel tag, run number, and title from the "What" column
        // using the same parser as the iCal adapter (same backend data)
        const parsed = parseICalSummary(row.title, kennelPatterns, defaultKennelTag);

        // Prefer run number from dedicated column, fall back to title
        const runNumber = row.runNumber ?? parsed.runNumber;

        // Build the detail page URL
        const detailUrl = row.detailUrl
          ? new URL(row.detailUrl, "https://www.sfh3.com").href
          : undefined;

        events.push({
          date,
          kennelTag: parsed.kennelTag,
          runNumber,
          title: parsed.title ?? row.title,
          hares: row.hare,
          location: row.locationText,
          locationUrl: row.locationUrl,
          startTime: undefined, // HTML table does not include start time
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
