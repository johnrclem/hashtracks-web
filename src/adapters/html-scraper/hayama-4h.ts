/**
 * Hayama 4H Hareline Scraper
 *
 * Scrapes sites.google.com/site/hayama4h/hashes — a Google Sites Classic page
 * that requires browser rendering (content loaded via JavaScript). The page
 * contains 200+ `<section>` elements, each with consistently formatted text:
 *
 *   No:204 Date:2026-03-29 Place: Mejiroyamashita(目白山下) Hare: Super Spreader
 *
 * Some sections also contain "Photo:", "Report:", or "Foods:" links after the
 * hare field. The kennel runs in the Hayama/Zushi area near Yokosuka, Japan.
 */

import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchBrowserRenderedPage } from "../utils";

/**
 * Parse a single section's text into RawEventData.
 * Exported for unit testing.
 *
 * Expected format:
 *   No:204 Date:2026-03-29 Place: Mejiroyamashita(目白山下) Hare: Super Spreader
 */
export function parseSectionText(
  text: string,
  sourceUrl: string,
): RawEventData | null {
  // Normalize whitespace (collapse runs, trim)
  const normalized = text.replaceAll(/\s+/g, " ").trim();
  if (!normalized) return null;

  // --- Run number ---
  const noMatch = /No:\s*(\d+)/i.exec(normalized);
  const runNumber = noMatch ? Number.parseInt(noMatch[1], 10) : undefined;

  // --- Date (YYYY-MM-DD) ---
  const dateMatch = /Date:\s*(\d{4}-\d{2}-\d{2})/i.exec(normalized);
  if (!dateMatch) return null;
  const date = dateMatch[1];

  // Validate the date is real
  const [y, m, d] = date.split("-").map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  if (
    dateObj.getUTCFullYear() !== y ||
    dateObj.getUTCMonth() !== m - 1 ||
    dateObj.getUTCDate() !== d
  ) {
    return null;
  }

  // --- Place ---
  const placeMatch = /Place:\s*(.+?)(?:\s*Hare:|$)/i.exec(normalized);
  const location = placeMatch ? placeMatch[1].trim() : undefined;

  // --- Hare ---
  const hareMatch = /Hare:\s*(.+?)(?:\s*(?:Photo|Report|Foods)\s*:|$)/i.exec(normalized);
  const hares = hareMatch ? hareMatch[1].trim() : undefined;

  // Build title
  const title = runNumber
    ? `Hayama 4H #${runNumber}`
    : "Hayama 4H Run";

  return {
    date,
    kennelTags: ["hayama-4h"],
    title,
    runNumber,
    hares: hares || undefined,
    location: location || undefined,
    sourceUrl,
  };
}

export class Hayama4HAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url =
      source.url || "https://sites.google.com/site/hayama4h/hashes";

    const page = await fetchBrowserRenderedPage(url, {
      waitFor: "section",
    });
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const sections = $("section");

    sections.each((i, el) => {
      try {
        const text = $(el).text();
        const event = parseSectionText(text, url);
        if (event) events.push(event);
      } catch (err) {
        errors.push(`Error parsing section ${i}: ${err}`);
        if (!errorDetails.parse) errorDetails.parse = [];
        errorDetails.parse.push({
          row: i,
          error: String(err),
          rawText: $(el).text().trim().slice(0, 2000),
        });
      }
    });

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        sectionsFound: sections.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
