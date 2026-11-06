/**
 * Nicosia Hash House Harriers (NH4-CY) — Cyprus, founded April 1989.
 *
 * Scrapes the Joomla "Upcoming Hares" article (nh4.com.cy/index.php/hare-line/
 * upcoming-hares): a single static `<table>` of `Run# | DD-Mon | Hares` rows,
 * pasted from a spreadsheet. Rows run a few months ahead; hare cells are blank
 * until someone signs up.
 *
 * Dates carry no year, so each one takes the year (last, this or next) that puts
 * it closest to today — safe for a table that spans a few months either side.
 * Runs are every Tuesday at 19:15 ("Tue 19:15 Every Week" on the home page),
 * so that is the start time. No titles → merge synthesizes "Nicosia H4 Trail #N".
 * Past rows age off the table, so the source ships `upcomingOnly: true`.
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ParseError } from "../types";
import { fetchHTMLPage, filterEventsByWindow } from "../utils";

const KENNEL_TAG = "nh4-cy";
const DEFAULT_URL = "https://nh4.com.cy/index.php/hare-line/upcoming-hares";
const START_TIME = "19:15";

const MONTHS = new Map<string, number>([
  ["jan", 1], ["feb", 2], ["mar", 3], ["apr", 4], ["may", 5], ["jun", 6],
  ["jul", 7], ["aug", 8], ["sep", 9], ["oct", 10], ["nov", 11], ["dec", 12],
]);
const DAY_MON_RE = /^(\d{1,2})-([A-Za-z]{3,9})$/;
const RUN_RE = /^\d{3,5}$/;

function clean(text: string): string {
  return text.replaceAll(" ", " ").replaceAll(/\s+/g, " ").trim();
}

/** "25-Aug" → the YYYY-MM-DD nearest to `now`; null if malformed. */
export function parseNicosiaDate(text: string, now: Date = new Date()): string | null {
  const m = DAY_MON_RE.exec(text.trim());
  if (!m) return null;
  const month = MONTHS.get(m[2].slice(0, 3).toLowerCase());
  if (!month) return null;
  const day = Number.parseInt(m[1], 10);
  let best: Date | null = null;
  for (const year of [now.getUTCFullYear() - 1, now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
    const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (d.getUTCMonth() !== month - 1) return null; // e.g. 31-Sep
    if (!best || Math.abs(d.getTime() - now.getTime()) < Math.abs(best.getTime() - now.getTime())) best = d;
  }
  return best ? best.toISOString().slice(0, 10) : null;
}

/** "Lymp Dick & Hala Madrid" / "Lunchbox/Insatiable Thirst" → sorted "A, B"; blank → null. */
export function splitHares(text: string): string | null {
  const names = clean(text)
    .replaceAll("&", ",")
    .replaceAll("/", ",")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) return null;
  return [...new Set(names)].sort((a, b) => a.localeCompare(b)).join(", ");
}

/** Parse the hareline table. Exported for tests. */
export function parseNicosiaHareline(
  html: string,
  sourceUrl = DEFAULT_URL,
  now: Date = new Date(),
): { events: RawEventData[]; rows: number; parseErrors: ParseError[] } {
  const $ = cheerio.load(html);
  const events: RawEventData[] = [];
  const parseErrors: ParseError[] = [];
  const rows = $("table tr").toArray();
  rows.forEach((tr, i) => {
    const cells = $(tr).find("td").toArray().map((td) => clean($(td).text()));
    if (cells.length < 2 || !RUN_RE.test(cells[0])) return;
    const date = parseNicosiaDate(cells[1], now);
    if (!date) {
      parseErrors.push({
        row: i,
        section: "hareline",
        error: `NH4-CY: unparseable date "${cells[1]}" on run ${cells[0]}`,
        rawText: cells.join(" | ").slice(0, 200),
      });
      return;
    }
    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber: Number.parseInt(cells[0], 10),
      startTime: START_TIME,
      hares: splitHares(cells[2] ?? ""),
      sourceUrl,
    });
  });
  return { events, rows: rows.length, parseErrors };
}

export class NicosiaHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { events, rows, parseErrors } = parseNicosiaHareline(page.html, url);
    const windowed = filterEventsByWindow(events, options?.days ?? 90);
    const errors = parseErrors.map((p) => p.error);
    if (events.length === 0) errors.push(`NH4-CY: no run rows found at ${url} (${rows} table rows)`);

    return {
      events: windowed,
      errors,
      structureHash: page.structureHash,
      errorDetails: parseErrors.length > 0 ? { parse: parseErrors } : undefined,
      diagnosticContext: {
        tableRows: rows,
        totalBeforeFilter: events.length,
        eventsParsed: windowed.length,
        fetchDurationMs: page.fetchDurationMs,
      },
    };
  }
}
