/**
 * Jamaica Hash House Harriers (JAH3) — first 🇯🇲 Jamaica kennel (Kingston, est. 1998).
 *
 * Scrapes https://www.jah3.com/kbean/hareline.php, a self-hosted PHP page with two
 * `<table class="hareline">` tables sharing the header Run | Date | Location | Hares:
 *
 *   0. "Hare Line"          — the forward table. Usually empty between postings
 *                              ("Sorry, nothing in the calendar yet."); the next run
 *                              is announced ~6 days ahead.
 *   1. "Receding Hare Line" — the full archive (#001 13 Feb 1998 → latest run).
 *
 * Both tables are parsed and the union is windowed by `options.days`, so recent
 * runs keep flowing in even while the forward table is empty. The source ships
 * `upcomingOnly: true`, so reconcile never cancels a run once it ages out of the
 * forward table. The deep archive is loaded once by scripts/backfill-jah3-history.ts.
 *
 * The site sits behind a Cloudflare "Just a moment…" challenge (Nov 2026), so the
 * page is fetched through the NAS headless browser, which clears the challenge.
 * Dates are year-bearing ("Sunday, 1 Nov, 2026"); there are no start times or
 * titles, so `title` stays undefined and merge synthesizes "Jamaica H3 Trail #N".
 */

import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ParseError } from "../types";
import { filterEventsByWindow } from "../utils";
import { generateStructureHash } from "@/pipeline/structure-hash";
import { browserRender } from "@/lib/browser-render";

const KENNEL_TAG = "jah3";
const DEFAULT_URL = "https://www.jah3.com/kbean/hareline.php";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// "Sunday, 1 Nov, 2026" → day, month word, year. Bounded quantifiers only.
const DATE_RE = /(\d{1,2}) ([A-Za-z]{3,9}),? (\d{4})/;
// Run cells are plain integers; a few specials carry a letter suffix ("477a").
const RUN_RE = /^(\d{1,4})([a-z]?)$/i;

function normalize(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

/**
 * True when the location cell marks the run as not happening on that date:
 * "CANCELLED", "CANCELLED - venue", "*** CANCELLED *** venue",
 * "venue (cancelled)" or "venue - POSTPONED".
 */
export function isCancelledCell(text: string): boolean {
  const s = text.toLowerCase();
  return s.includes("cancelled") || s.includes("postponed");
}

/** Parse "Weekday, D Mon, YYYY" to "YYYY-MM-DD"; null if malformed. */
export function parseJamaicaDate(text: string): string | null {
  const m = DATE_RE.exec(text);
  if (!m) return null;
  const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (!month) return null;
  const day = Number.parseInt(m[1], 10);
  const year = Number.parseInt(m[3], 10);
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/** Split "A, B & C and D" into a sorted, de-duplicated "A, B, C, D". */
export function splitHares(text: string): string | undefined {
  const names = normalize(text)
    .replaceAll(" & ", ",")
    .replaceAll(" and ", ",")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) return undefined;
  return [...new Set(names)].sort((a, b) => a.localeCompare(b)).join(", ");
}

/** One hareline row → event, or null for header/sentinel/cancelled rows. */
export function parseHarelineRow(cells: string[], baseUrl: string): RawEventData | null {
  if (cells.length < 4) return null;
  const run = RUN_RE.exec(cells[0]);
  if (!run) return null;
  const location = cells[2];
  if (isCancelledCell(location)) return null;
  const date = parseJamaicaDate(cells[1]);
  if (!date) throw new Error(`unparseable date "${cells[1]}" on run ${cells[0]}`);
  return {
    date,
    kennelTags: [KENNEL_TAG],
    // A suffixed special ("477a") shares its number with the regular run, so it
    // carries no runNumber rather than a duplicate one.
    runNumber: run[2] ? undefined : Number.parseInt(run[1], 10),
    location: location || undefined,
    hares: splitHares(cells[3]),
    sourceUrl: baseUrl,
  };
}

function rowCells($: CheerioAPI, tr: Element): string[] {
  return $(tr)
    .find("td")
    .toArray()
    .map((td) => normalize($(td).text()));
}

/** Parse both hareline tables. Exported for tests. */
export function parseJamaicaHareline(
  html: string,
  baseUrl = DEFAULT_URL,
): { events: RawEventData[]; tables: number; parseErrors: ParseError[] } {
  const $ = cheerio.load(html);
  const tables = $("table.hareline");
  const events: RawEventData[] = [];
  const parseErrors: ParseError[] = [];
  const seen = new Set<string>();
  tables.each((t, table) => {
    $(table)
      .find("tr")
      .each((i, tr) => {
        const cells = rowCells($, tr);
        try {
          const event = parseHarelineRow(cells, baseUrl);
          // A run can appear in both tables during the hand-off; keep the first.
          const key = `${cells[0]}|${event?.date}`;
          if (!event || seen.has(key)) return;
          seen.add(key);
          events.push(event);
        } catch (err) {
          parseErrors.push({
            row: i,
            section: t === 0 ? "hareline" : "receding",
            error: `JAH3: ${err instanceof Error ? err.message : String(err)}`,
            rawText: cells.join(" | ").slice(0, 200),
          });
        }
      });
  });
  return { events, tables: tables.length, parseErrors };
}

export class JamaicaHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const fetchStart = Date.now();
    let html: string;
    try {
      html = await browserRender({ url, waitFor: "table.hareline", timeout: 30000 });
    } catch (err) {
      const message = `JAH3: render failed: ${err instanceof Error ? err.message : String(err)}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url, message }] } };
    }

    const { events, tables, parseErrors } = parseJamaicaHareline(html, url);
    const windowed = filterEventsByWindow(events, options?.days ?? 90);

    const errors = parseErrors.map((p) => p.error);
    // Fail loud on structural drift only. An empty forward table with the archive
    // present is the normal between-postings state.
    if (tables === 0) errors.push(`JAH3: no hareline tables found at ${url}`);

    return {
      events: windowed,
      errors,
      structureHash: generateStructureHash(html),
      errorDetails: parseErrors.length > 0 ? { parse: parseErrors } : undefined,
      diagnosticContext: {
        tablesFound: tables,
        totalBeforeFilter: events.length,
        eventsParsed: windowed.length,
        fetchDurationMs: Date.now() - fetchStart,
      },
    };
  }
}
