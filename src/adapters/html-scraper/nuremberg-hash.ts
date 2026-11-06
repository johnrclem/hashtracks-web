/**
 * Nuremberg Hash House Harriers (NH3-DE) — Nürnberg, Franconia, Germany.
 *
 * The kennel's WordPress `/run-info/` page (read via WP REST
 * `/wp-json/wp/v2/pages?slug=run-info`) holds two kinds of `<table>`:
 *
 *   - Run detail blocks — two-column label/value tables:
 *       Number: NH3 Run #102 – The double Hare r*n (co-r*n with Munich MH3)
 *       Description / Hare / Date ("Saturday 10th October 2026") / Time ("14:00") /
 *       Venue ("Ingolstadt <br>(Details TBA)") / How to get there / Google Maps
 *     ("Next run", "Upcoming runs" and "Old runs" all use this shape.)
 *   - Yearly hareline tables — `Date | HARE | LOCATION`, the hare in `<strong>`
 *     with an optional theme line after `<br>` ("Rainbow Warrior<br>Easter Egg r*n").
 *     These carry no run numbers.
 *
 * One event per date: a detail block wins over a hareline row within two days
 * of it; hareline rows add the runs not yet written up. "Cancelled" / "Not
 * scheduled" rows are skipped. Upcoming blocks move to "Old runs" and old
 * hareline years get dropped, so the source ships `upcomingOnly: true`.
 */

import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { decodeEntities, filterEventsByWindow } from "../utils";
import { safeFetch } from "../safe-fetch";
import { generateStructureHash } from "@/pipeline/structure-hash";

const KENNEL_TAG = "nh3-de";
const DEFAULT_URL = "https://nuremberg-h3.de/wp-json/wp/v2/pages?slug=run-info";
const PAGE_URL = "https://nuremberg-h3.de/run-info/";
const DAY_MS = 86_400_000;

const MONTHS = new Map<string, number>([
  ["jan", 1], ["feb", 2], ["mar", 3], ["apr", 4], ["may", 5], ["jun", 6],
  ["jul", 7], ["aug", 8], ["sep", 9], ["oct", 10], ["nov", 11], ["dec", 12],
]);
// "Saturday 10th October 2026" / "January 17th, 2026" / "July 25-27th 2025" / "December 19+20th 2025".
const DAY_FIRST_RE = /\b(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]{3,9}),? (\d{4})\b/;
const MONTH_FIRST_RE = /\b([A-Za-z]{3,9}) (\d{1,2})(?:[-+]\d{1,2})?(?:st|nd|rd|th)?,? (\d{4})\b/;
const RUN_RE = /#(\d{1,4})/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const SKIP_VALUES = ["cancelled", "not scheduled"];
const PLACEHOLDERS = new Set(["", "tba", "tbd", "–", "-"]);

function clean(text: string): string {
  return decodeEntities(text).replaceAll(/\s+/g, " ").trim();
}

function toIso(year: number, month: number | undefined, day: number): string | null {
  if (!month) return null;
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/** Both date styles used on the page; multi-day ranges take the first day. */
export function parseNurembergDate(text: string): string | null {
  const df = DAY_FIRST_RE.exec(text);
  if (df) return toIso(Number.parseInt(df[3], 10), MONTHS.get(df[2].slice(0, 3).toLowerCase()), Number.parseInt(df[1], 10));
  const mf = MONTH_FIRST_RE.exec(text);
  if (mf) return toIso(Number.parseInt(mf[3], 10), MONTHS.get(mf[1].slice(0, 3).toLowerCase()), Number.parseInt(mf[2], 10));
  return null;
}

/** "Squeeze It + MFT" / "Swans + STD" → sorted list; placeholders → undefined. */
export function splitHares(text: string): string | undefined {
  const v = clean(text);
  if (PLACEHOLDERS.has(v.toLowerCase())) return undefined;
  const names = v
    .replaceAll(" + ", ",")
    .replaceAll(" & ", ",")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) return undefined;
  return [...new Set(names)].sort((a, b) => a.localeCompare(b)).join(", ");
}

/** Text lines of a cell, split on `<br>`. */
function cellLines($: CheerioAPI, cell: Cheerio<Element>): string[] {
  const html = (cell.html() ?? "").replaceAll(/<br\s*\/?>/gi, "\n");
  return cheerio.load(html).root().text().split("\n").map(clean).filter(Boolean);
}

function isSkipped(text: string): boolean {
  const lower = text.toLowerCase();
  return SKIP_VALUES.some((s) => lower.startsWith(s));
}

/** First line of a venue cell, minus "(Details TBA)"-style notes; placeholders → undefined. */
function venueOf(lines: string[]): string | undefined {
  const first = lines.find((l) => !l.startsWith("("));
  return first && !PLACEHOLDERS.has(first.toLowerCase()) ? first : undefined;
}

/** A label/value detail table → event. Exported for tests. */
export function parseDetailTable($: CheerioAPI, table: Cheerio<Element>): RawEventData | null {
  const fields = new Map<string, Cheerio<Element>>();
  table.find("tr").each((_i, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 2) return;
    fields.set(clean(cells.eq(0).text()).replace(/:$/, "").toLowerCase(), cells.eq(1));
  });
  const text = (label: string) => {
    const cell = fields.get(label);
    return cell ? clean(cell.text()) : "";
  };
  const date = parseNurembergDate(text("date"));
  if (!date) return null;
  const number = text("number");
  const run = RUN_RE.exec(number);
  const dash = number.indexOf("–");
  const title = dash >= 0 ? number.slice(dash + 1).trim() : undefined;
  const time = TIME_RE.exec(text("time"));
  const maps = text("google maps");
  const venueCell = fields.get("venue");
  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber: run ? Number.parseInt(run[1], 10) : undefined,
    title: title || undefined,
    hares: splitHares(text("hare")),
    startTime: time ? `${time[1].padStart(2, "0")}:${time[2]}` : undefined,
    location: venueCell ? venueOf(cellLines($, venueCell)) : undefined,
    locationUrl: maps.startsWith("https://") ? maps : undefined,
    description: text("description") || undefined,
    sourceUrl: PAGE_URL,
  };
}

/** A yearly hareline table → events. Exported for tests. */
export function parseHarelineTable($: CheerioAPI, table: Cheerio<Element>): RawEventData[] {
  const events: RawEventData[] = [];
  table.find("tr").each((_i, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 3) return;
    const date = parseNurembergDate(clean(cells.eq(0).text()));
    const hareLines = cellLines($, cells.eq(1));
    const location = clean(cells.eq(2).text());
    if (!date || isSkipped(hareLines[0] ?? "") || isSkipped(location)) return;
    const theme = hareLines.slice(1).join(" ").replace(/^\((.*)\)$/, "$1");
    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      title: theme || undefined,
      hares: splitHares(hareLines[0] ?? ""),
      location: PLACEHOLDERS.has(location.toLowerCase()) ? undefined : location,
      sourceUrl: PAGE_URL,
    });
  });
  return events;
}

/** Parse the whole rendered page. Exported for tests. */
export function parseNurembergPage(rendered: string): { events: RawEventData[]; tables: number } {
  const $ = cheerio.load(rendered);
  const byDate = new Map<string, RawEventData>();
  const details: RawEventData[] = [];
  const tables = $("table").toArray();
  for (const el of tables) {
    const table = $(el);
    const firstCell = clean(table.find("td, th").first().text()).toLowerCase();
    if (firstCell.startsWith("number")) {
      const event = parseDetailTable($, table);
      if (event) details.push(event);
    } else if (firstCell === "date") {
      for (const event of parseHarelineTable($, table)) if (!byDate.has(event.date)) byDate.set(event.date, event);
    }
  }
  // A detail block replaces any hareline row within two days of it (a "19+20th"
  // weekend row vs. the write-up dated the 20th).
  for (const event of details) {
    for (const date of [...byDate.keys()]) {
      if (Math.abs(Date.parse(date) - Date.parse(event.date)) <= 2 * DAY_MS) byDate.delete(date);
    }
  }
  for (const event of details) byDate.set(event.date, event);
  return { events: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), tables: tables.length };
}

export class NurembergHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const fetchStart = Date.now();
    let rendered: string;
    try {
      const res = await safeFetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: unknown = await res.json();
      const first = Array.isArray(body) ? (body[0] as { content?: { rendered?: unknown } } | undefined) : undefined;
      if (typeof first?.content?.rendered !== "string") throw new Error("unexpected WP REST payload");
      rendered = first.content.rendered;
    } catch (err) {
      const message = `NH3-DE: fetch failed: ${err instanceof Error ? err.message : String(err)}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url, message }] } };
    }

    const { events, tables } = parseNurembergPage(rendered);
    const errors: string[] = [];
    if (events.length === 0) errors.push(`NH3-DE: no runs parsed from ${url} (${tables} tables)`);
    const windowed = filterEventsByWindow(events, options?.days ?? 90);
    return {
      events: windowed,
      errors,
      structureHash: generateStructureHash(rendered),
      diagnosticContext: { tables, totalBeforeFilter: events.length, eventsParsed: windowed.length, fetchDurationMs: Date.now() - fetchStart },
    };
  }
}
