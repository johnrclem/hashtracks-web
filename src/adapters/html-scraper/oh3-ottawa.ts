/**
 * Ottawa H3 (OH3) Google Doc Published Hareline Scraper
 *
 * Scrapes the published Google Doc at docs.google.com/document/d/.../pub
 * for upcoming run details. The doc has two sections:
 *
 * 1. Detailed events separated by <hr> with labeled fields:
 *    R*n # 2203, When, Hares, Start, ON IN, Hash Cash, Map, Note
 *
 * 2. Planning-ahead section with one-line-per-event future runs:
 *    2208    Monday, 4 May    2026    NEED A HARE
 *
 * kennelTag: "oh3-ca"
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import {
  fetchHTMLPage,
  chronoParseDate,
  stripHtmlTags,
  stripPlaceholder,
  buildDateWindow,
} from "../utils";

const DEFAULT_START_TIME = "18:45";
const KENNEL_TAG = "oh3-ca";

/**
 * Parse a detailed event block (text between <hr> tags).
 *
 * Expected format:
 *   R*n # 2203                Just wait until they see & hear me!
 *   When:                     Monday, 30 March 2026 @ 6:45 p.m.
 *   Hares:                    Didgeri-Do-Me
 *   Start:                    Coliseum Theatre   Carling Ave
 *   ON IN:                    Lorenzo's Pizza
 *   Hash Cash:                $5
 *   Map:                      https://...
 *   Note 1:                   Expect shiggy!
 */
export function parseDetailedBlock(text: string): RawEventData | null {
  // Run number + optional title: "R*n # 2203   Just wait until they see & hear me!"
  // The * is a literal asterisk (self-censored "Run")
  const runMatch = /R\*n\s*#\s*(\d+)\s*(.*)/i.exec(text);
  if (!runMatch) return null;

  const runNumber = Number.parseInt(runMatch[1], 10);
  const title = runMatch[2].trim() || undefined;

  // Parse labeled fields
  const whenMatch = /When:\s*(.+?)(?=\n|$)/i.exec(text);
  const haresMatch = /Hares?:\s*(.+?)(?=\n|$)/i.exec(text);
  const startMatch = /Start:\s*(.+?)(?=\n|$)/i.exec(text);
  const onInMatch = /ON\s*IN:\s*(.+?)(?=\n|$)/i.exec(text);
  const hashCashMatch = /Hash\s*Cash:\s*(.+?)(?=\n|$)/i.exec(text);
  const mapMatch = /Map:\s*(https?:\/\/\S+)/i.exec(text);
  const noteMatch = /Note(?:\s*\d+)?:\s*(.+?)(?=\n|$)/i.exec(text);

  // Parse date from "When:" field — format: "Monday, 30 March 2026 @ 6:45 p.m."
  if (!whenMatch) return null;
  const whenText = whenMatch[1].trim();

  // Split on @ to separate date and time
  const [datePart, timePart] = whenText.split("@").map((s) => s.trim());
  const dateStr = chronoParseDate(datePart, "en-GB");
  if (!dateStr) return null;

  // Parse time from "6:45 p.m." format
  let startTime = DEFAULT_START_TIME;
  if (timePart) {
    const timeStr = parseOttawaTime(timePart);
    if (timeStr) startTime = timeStr;
  }

  const descParts: string[] = [];
  if (noteMatch) descParts.push(noteMatch[1].trim());
  if (onInMatch) descParts.push(`ON IN: ${onInMatch[1].trim()}`);

  return {
    date: dateStr,
    kennelTag: KENNEL_TAG,
    runNumber,
    title,
    hares: stripPlaceholder(haresMatch?.[1]),
    location: stripPlaceholder(startMatch?.[1]),
    locationUrl: mapMatch?.[1],
    startTime,
    description: descParts.length > 0 ? descParts.join(" | ") : undefined,
  };
}

/**
 * Parse Ottawa-style time: "6:45 p.m." or "7:00 a.m."
 * Returns "HH:MM" format or undefined.
 */
export function parseOttawaTime(text: string): string | undefined {
  const match = /(\d{1,2}):(\d{2})\s*([ap])\.?m\.?/i.exec(text);
  if (!match) return undefined;

  let hours = Number.parseInt(match[1], 10);
  const mins = match[2];
  const ampm = match[3].toLowerCase();

  if (ampm === "p" && hours !== 12) hours += 12;
  if (ampm === "a" && hours === 12) hours = 0;

  return `${hours.toString().padStart(2, "0")}:${mins}`;
}

/**
 * Parse a planning-ahead line into a minimal RawEventData.
 *
 * Format: "2208    Monday, 4 May    2026    NEED A HARE"
 * Or:     "2210    Monday, 18 May   2026    Alkasleezer"
 */
export function parsePlanningLine(text: string): RawEventData | null {
  const match = /^\s*(\d{4})\s+\w+,\s*(\d{1,2}\s+\w+)\s+(\d{4})\s+(.*)/m.exec(text);
  if (!match) return null;

  const runNumber = Number.parseInt(match[1], 10);
  const dayMonth = match[2].trim();
  const year = match[3];
  const hareOrNote = match[4].trim();

  const dateStr = chronoParseDate(`${dayMonth} ${year}`, "en-GB");
  if (!dateStr) return null;

  // "NEED A HARE" means no hare assigned
  const isNeedHare = /NEED\s+A\s+HARE/i.test(hareOrNote);
  const hares = isNeedHare ? undefined : stripPlaceholder(hareOrNote) || undefined;

  // If hares are assigned, use that as title too (planning lines don't have separate titles)
  const title = isNeedHare ? undefined : hares;

  return {
    date: dateStr,
    kennelTag: KENNEL_TAG,
    runNumber,
    title,
    hares,
    startTime: DEFAULT_START_TIME,
  };
}

/**
 * Ottawa H3 Google Doc Published Hareline Adapter
 *
 * Fetches the published Google Doc and extracts events from two sections:
 * 1. Detailed event blocks (separated by <hr>)
 * 2. Planning-ahead one-liners
 */
export class Oh3OttawaAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url =
      source.url ||
      "https://docs.google.com/document/d/1jGyBUKxOYkxrZg8WVfpBYDP84fbacanoX_TJuyCmtAI/pub";

    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const days = _options?.days ?? (source as Record<string, unknown>).scrapeDays as number ?? 365;
    const { minDate, maxDate } = buildDateWindow(days);

    const events: RawEventData[] = [];
    const errors: string[] = [];

    // Get the document content div
    const contentDiv = $("#contents .doc-content");
    if (contentDiv.length === 0) {
      return {
        events: [],
        errors: ["Could not find document content"],
        structureHash,
      };
    }

    // Split content by <hr> tags into sections
    const contentHtml = contentDiv.html() || "";

    // Split on <hr> to get sections
    const sections = contentHtml.split(/<hr\s*\/?>/i);

    let planningMode = false;

    for (const section of sections) {
      const sectionText = stripHtmlTags(section, "\n").trim();
      if (!sectionText) continue;

      // Detect planning-ahead section
      if (/Planning\s+ahead/i.test(sectionText)) {
        planningMode = true;
      }

      if (planningMode) {
        // Parse each line as a planning-ahead entry
        const lines = sectionText.split("\n");
        for (const line of lines) {
          if (/^\s*\d{4}\s+\w+,/.test(line)) {
            const event = parsePlanningLine(line);
            if (event) {
              const eventDate = new Date(event.date + "T12:00:00Z");
              if (eventDate >= minDate && eventDate <= maxDate) {
                events.push(event);
              }
            }
          }
        }
      } else {
        // Try to parse as a detailed event block
        if (/R\*n\s*#/i.test(sectionText)) {
          try {
            const event = parseDetailedBlock(sectionText);
            if (event) {
              const eventDate = new Date(event.date + "T12:00:00Z");
              if (eventDate >= minDate && eventDate <= maxDate) {
                events.push(event);
              }
            }
          } catch (err) {
            errors.push(`Parse error in detailed block: ${err}`);
          }
        }
      }
    }

    return {
      events,
      errors,
      structureHash,
      diagnosticContext: {
        fetchMethod: "google-doc-pub",
        sectionsFound: sections.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
