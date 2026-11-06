/**
 * Oxford H3 (Oxford, England) HTML Scraper
 *
 * Scrapes the "Hash Diary" table on www.oxfordh3.org.uk — a WordPress page
 * embedding a Google Sheet through the Inline Google Spreadsheet Viewer
 * plugin (rows `tr[id^="igsv-"]`), fully server-rendered. Columns (mapped by
 * header text; the archive page /run-list-3-2/ has the same layout):
 *   Date ("04/11/2026 19:00", "30/9/15 19:00", "30/09/2026 19:00:00") |
 *   Post Code | Venue | Hares | Map Link | Run# | Beer Master | Chef | Tick |
 *   Parking and other instructions
 * Future rows are filled in gradually: many lack a run number, some only name
 * a social ("Christmas Dinner") in the Venue cell, and the tail is blank
 * skeleton rows — those (no venue, hares or run number) are skipped. The Map
 * Link cell is free text (often just the pub's name) and is only used when it
 * is a Google Maps URL.
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchHTMLPage, buildDateWindow } from "../utils";

const KENNEL_TAG = "oxford-h3";
const DEFAULT_URL = "https://www.oxfordh3.org.uk/";

const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:\s+(\d{1,2}):(\d{2}))?/;
const MAPS_URL_RE = /^https?:\/\/(?:goo\.gl\/maps|maps\.app\.goo\.gl|(?:www\.)?google\.[a-z.]+\/maps)/i;

export type OxfordColumn = "date" | "postcode" | "venue" | "hares" | "map" | "run" | "notes";

/** Map a header cell's text to a column key. */
export function oxfordHeaderKey(text: string): OxfordColumn | undefined {
  const t = text.toLowerCase().trim();
  if (t === "date") return "date";
  if (t === "post code" || t === "postcode") return "postcode";
  if (t === "venue") return "venue";
  if (t === "hares" || t === "hare") return "hares";
  if (t === "map link") return "map";
  if (t.startsWith("run")) return "run";
  if (t.startsWith("parking")) return "notes";
  return undefined;
}

/** "04/11/2026 19:00" / "30/9/15 19:00" → date + startTime. */
export function parseOxfordDate(text: string): { date: string; startTime?: string } | null {
  const m = DATE_RE.exec(text.trim());
  if (!m) return null;
  let year = Number.parseInt(m[3], 10);
  if (year < 100) year += 2000;
  const month = Number.parseInt(m[2], 10);
  const day = Number.parseInt(m[1], 10);
  const dt = new Date(Date.UTC(year, month - 1, day, 12));
  if (dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  let startTime: string | undefined;
  if (m[4] && Number.parseInt(m[4], 10) <= 23) startTime = `${m[4].padStart(2, "0")}:${m[5]}`;
  return { date: dt.toISOString().slice(0, 10), startTime };
}

function cell(text: string | undefined): string | undefined {
  const t = text?.replaceAll("\u00a0", " ").replace(/\s+/g, " ").trim();
  if (!t || /^(?:n\/a|tba|tbc|-)$/i.test(t)) return undefined;
  return t;
}

/** Parse one row (cells keyed by column). Null for skeleton / undated rows. */
export function parseOxfordRow(
  cells: Partial<Record<OxfordColumn, string>>,
  sourceUrl = DEFAULT_URL,
): RawEventData | null {
  const when = parseOxfordDate(cells.date ?? "");
  if (!when) return null;
  const runText = cell(cells.run);
  const runNumber = runText && /^\d{1,5}$/.test(runText) ? Number.parseInt(runText, 10) : undefined;
  const venue = cell(cells.venue);
  const hares = cell(cells.hares);
  if (!venue && !hares && runNumber === undefined) return null;
  // "NO HASH" (Christmas Day) / "No run this week due to …" placeholders.
  if (venue && /^no (?:hash|run)\b/i.test(venue)) return null;

  const postcode = cell(cells.postcode)?.toUpperCase();
  const map = cell(cells.map);
  // An unnumbered row whose Venue cell is a bare label ("Christmas Dinner",
  // "Red Dress run") names a social, not a place: no comma, no postcode.
  const isSocialLabel = runNumber === undefined && !!venue && !postcode && !venue.includes(",");
  return {
    date: when.date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    title: isSocialLabel ? venue : undefined,
    startTime: when.startTime,
    location: isSocialLabel ? undefined : venue,
    locationStreet: venue && postcode && !venue.toUpperCase().includes(postcode) ? postcode : undefined,
    locationUrl: map && MAPS_URL_RE.test(map) ? map : undefined,
    hares,
    description: cell(cells.notes),
    sourceUrl,
  };
}

/** Parse every run table on an Oxford H3 page. Exported for the history backfill. */
export function parseOxfordTables(html: string, sourceUrl = DEFAULT_URL): RawEventData[] {
  const $ = cheerio.load(html);
  const events: RawEventData[] = [];
  $("table").each((_t, table) => {
    const columns = $(table).find("thead tr, tr").first().find("th,td").map((_c, c) => oxfordHeaderKey($(c).text())).get();
    if (!columns.includes("date") || !columns.includes("venue")) return;
    $(table).find("tbody tr").each((_r, tr) => {
      const cells: Partial<Record<OxfordColumn, string>> = {};
      $(tr).find("td").each((i, td) => {
        const key = columns[i] as OxfordColumn | undefined;
        if (key) cells[key] = $(td).text();
      });
      const event = parseOxfordRow(cells, sourceUrl);
      if (event) events.push(event);
    });
  });
  return events;
}

export class OxfordH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const sourceUrl = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { html, structureHash, fetchDurationMs } = page;

    const parsed = parseOxfordTables(html, sourceUrl);
    if (parsed.length === 0) {
      return {
        events: [],
        errors: ["Oxford H3: 0 rows parsed from the Hash Diary table — markup drift"],
        structureHash,
        diagnosticContext: { fetchDurationMs },
      };
    }

    const { minDate, maxDate } = buildDateWindow(options?.days ?? 180);
    const events = parsed.filter((e) => {
      const d = new Date(`${e.date}T12:00:00Z`);
      return d >= minDate && d <= maxDate;
    });

    return {
      events,
      errors: [],
      structureHash,
      diagnosticContext: { rowsParsed: parsed.length, eventsInWindow: events.length, fetchDurationMs },
    };
  }
}
