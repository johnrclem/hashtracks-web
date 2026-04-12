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

  // Extract hare name: everything after the last " – " or after the run number
  let hares: string | undefined;
  const afterRun = cleaned.slice(runMatch.index + runMatch[0].length);
  const harePart = afterRun.replace(/^\s*[-–—]\s*/, "").trim();
  if (harePart && !/^HARE NEEDED$/i.test(harePart) && !/^\?+$/.test(harePart)) {
    hares = normalizeHaresField(harePart);
  }

  // Parse date from the beginning of the line (before kennel code or "Run")
  const beforeRun = cleaned.slice(0, runMatch.index).trim();
  // Strip kennel tags (CH3, CH4, CSH3, CGH3, CBH3, CDH3, etc.)
  const dateText = beforeRun
    .replace(/\b(?:CH[34]|C[SGB]H3|CDH3|CFMH3)\b/gi, "")
    .replace(/[-–—]+/g, " ")
    .trim();

  // The hareline pages have month headers (e.g. "<b>April 2026</b>") but
  // individual lines are yearless ("Saturday April 11"). chrono defaults
  // to the current year which is correct for the current/next-month
  // hareline. The adapter's applyDateWindow() filter handles anything
  // that falls outside the configured window.
  const date = chronoParseDate(dateText, "en-GB");
  if (!date) return null;

  return {
    date,
    kennelTag,
    runNumber,
    hares,
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
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip month headings like "April 2026"
      if (/^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i.test(line)) {
        continue;
      }

      try {
        const event = parseChiangMaiLine(line, kennelTag, baseUrl);
        if (event) {
          event.startTime = defaultTime;
          events.push(event);
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
