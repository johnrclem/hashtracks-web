import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import {
  applyDateWindow,
  chronoParseDate,
  decodeEntities,
  fetchHTMLPage,
  normalizeHaresField,
  stripHtmlTags,
} from "../utils";

/**
 * Chiang Mai Hash House Harriers shared adapter.
 *
 * chiangmaihhh.com is a WordPress site hosting 5 separate hareline pages:
 *   /ch3-hareline/  → CH3 (Monday, men only)
 *   /ch4-hareline/  → CH4 (Thursday)
 *   /cgh3-hareline/ → CGH3 (Biweekly Monday, men only)
 *   /csh3-hareline/ → CSH3 (Saturday)
 *   /cbh3-hareline/ → CBH3 (Monthly, last Sunday, women)
 *
 * Each page has `<br>`-delimited text lines inside `.entry-content`:
 *   "Monday 6th April CH3 Run # 1631 Suckit"
 *   "Thursday 2 April – CH4 Run # 1098 – ABB & Anal Vice"
 *   "Saturday April 4 – CSH3 – Run #1805 – Head Hacker"
 *
 * IMPORTANT: chiangmaihhh.com is HTTP-only. HTTPS fails.
 *
 * The source config specifies which hareline page to scrape:
 *   { "harelinePath": "/ch3-hareline/", "kennelTag": "ch3-cm" }
 */

/** Default kennel tag to hareline path mapping. */
const HARELINE_PAGES: Record<string, { path: string; kennelTag: string; defaultTime: string }> = {
  ch3: { path: "/ch3-hareline/", kennelTag: "ch3-cm", defaultTime: "17:00" },
  ch4: { path: "/ch4-hareline/", kennelTag: "ch4-cm", defaultTime: "17:00" },
  cgh3: { path: "/cgh3-hareline/", kennelTag: "cgh3", defaultTime: "17:00" },
  csh3: { path: "/csh3-hareline/", kennelTag: "csh3", defaultTime: "17:00" },
  cbh3: { path: "/cbh3-hareline/", kennelTag: "cbh3-cm", defaultTime: "17:00" },
};

/**
 * Parse a single hareline line.
 *
 * Patterns:
 *   "Monday 6th April CH3  Run # 1631 Suckit"
 *   "Thursday 2 April – CH4 Run # 1098 –  ABB & Anal Vice"
 *   "Saturday April 4 – CSH3 – Run #1805 – Head Hacker"
 *   "Sunday 26 April – CBH3 – Run # 281 – Misfortune and Bare Bum"
 *
 * Exported for unit testing.
 */
export function parseChiangMaiLine(
  line: string,
  kennelTag: string,
  sourceUrl: string,
  referenceYear?: number,
): RawEventData | null {
  const cleaned = decodeEntities(line).replace(/\u2013|\u2014/g, "-").trim();
  if (!cleaned) return null;

  // Must contain "Run" and a proper number — skip placeholders like "16xx"
  const runMatch = /Run\s*#?\s*(\d+[a-z]*)/i.exec(cleaned);
  if (!runMatch) return null;

  // Skip placeholders like "16xx" (digits followed by letters)
  if (/[a-z]/i.test(runMatch[1])) return null;

  const runNumberRaw = Number.parseInt(runMatch[1], 10);
  const runNumber = Number.isNaN(runNumberRaw) ? undefined : runNumberRaw;

  // The text after the run number is both the hare list (normalized) and the
  // event title (verbatim — populating it stops merge.ts from synthesizing
  // a default "{kennel.fullName} Trail #{N}" string).
  // CGH3 pages prefix the name with a "Hare." label (e.g. "Hare. HRA") — strip
  // it so only the name survives.
  let hares: string | undefined;
  let title: string | undefined;
  const afterRun = cleaned.slice(runMatch.index + runMatch[0].length);
  const harePart = afterRun
    .replace(/^\s*[-–—]\s*/, "")
    .replace(/^Hares?\s*[.:]\s*/i, "")
    .trim();
  if (harePart && !/^HARE NEEDED$/i.test(harePart) && !/^\?+$/.test(harePart)) {
    hares = normalizeHaresField(harePart);
    title = harePart;
  }

  const beforeRun = cleaned.slice(0, runMatch.index).trim();
  // Strip kennel tags then normalize "Month DD" → "DD Month" — chrono's en-GB
  // parser drops the month entirely on the "Saturday April 25" shape and
  // returns the next Saturday, ignoring the date.
  const dateText = beforeRun
    .replace(/\b(?:CH[34]|C[SGB]H3|CDH3|CFMH3)\b/gi, "")
    .replace(/[-–—]+/g, " ")
    .replace(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi,
      "$2 $1",
    )
    .trim();

  // forwardDate is essential when we have a reference year: without it,
  // chrono picks the calendar-closest match and silently rolls late-year
  // events back to the prior year (mid-year is equidistant from a Jan 1
  // reference and chrono favors past dates).
  const refDate = referenceYear ? new Date(Date.UTC(referenceYear, 0, 1)) : undefined;
  const date = chronoParseDate(dateText, "en-GB", refDate, {
    forwardDate: referenceYear !== undefined,
  });
  if (!date) return null;

  return {
    date,
    kennelTag,
    runNumber,
    hares,
    title,
    sourceUrl,
  };
}

export class ChiangMaiHHHAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const config = (source.config ?? {}) as Record<string, unknown>;
    const harelineKey = (config.harelineKey as string) ?? "ch3";
    const pageConfig = HARELINE_PAGES[harelineKey];

    if (!pageConfig) {
      return {
        events: [],
        errors: [`ChiangMaiHHH: unknown harelineKey "${harelineKey}"`],
      };
    }

    // IMPORTANT: chiangmaihhh.com is HTTP-only — HTTPS fails
    const baseUrl = source.url || `http://www.chiangmaihhh.com${pageConfig.path}`;
    const { kennelTag, defaultTime } = pageConfig;

    const page = await fetchHTMLPage(baseUrl);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Extract text from .entry-content div, split by <br> tags
    const contentHtml = $(".entry-content").html() ?? "";
    const text = stripHtmlTags(contentHtml, "\n");
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

    let linesParsed = 0;
    let currentYear: number | undefined;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Extract year from month headings like "April 2026" — pass to
      // parseChiangMaiLine so yearless dates resolve correctly.
      const yearMatch = /\b(20\d{2})\b/.exec(line);
      if (/^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i.test(line)) {
        if (yearMatch) currentYear = Number.parseInt(yearMatch[1], 10);
        continue;
      }

      try {
        const event = parseChiangMaiLine(line, kennelTag, baseUrl, currentYear);
        if (event) {
          events.push({ ...event, startTime: defaultTime });
        }
      } catch (err) {
        errors.push(`Error parsing line ${i}: ${err}`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          { row: i, section: "hareline", error: String(err), rawText: line.slice(0, 2000) },
        ];
      }
      linesParsed++;
    }

    if (events.length === 0 && errors.length === 0) {
      errors.push(`ChiangMai ${harelineKey}: zero events parsed from hareline`);
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
          harelineKey,
          linesFound: linesParsed,
          eventsParsed: events.length,
          fetchDurationMs,
        },
      },
      days,
    );
  }
}
