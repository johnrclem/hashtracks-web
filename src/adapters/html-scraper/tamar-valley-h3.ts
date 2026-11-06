import type { CheerioAPI } from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { applyDateWindow, fetchHTMLPage, MONTHS, parse12HourTime } from "../utils";
import { isPlaceholderCell } from "./legacy-frontpage-utils";

const KENNEL_TAG = "tamar-h3";
const DEFAULT_URL = "https://www.tvh3.co.uk/";
const DEFAULT_START_TIME = "19:00";

/** Next-run block date: `9th November 2026`. Month word validated via MONTHS. */
const LONG_DATE_RE = /(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]+) (\d{4})/;
/** Forward-table date: `16/11/26` (DD/MM/YY). */
const SHORT_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;
/** Site-wide start-time banner: `TVH3 runs start at 7.00pm`. */
const START_BANNER_RE = /runs? +start at (\d{1,2})[.:](\d{2}) ?(am|pm)/i;

function isoDate(year: number, month: number, day: number): string | null {
  const fullYear = year < 100 ? 2000 + year : year;
  const d = new Date(Date.UTC(fullYear, month - 1, day, 12, 0, 0));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/** Collapse whitespace (the FrontPage markup wraps labels mid-word: "On \n Down:"). */
function clean(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

/**
 * Strip the `- what3words - ///word.word.word` tail from a venue cell. The
 * what3words address goes to `description`; it is not a Maps URL, so it is
 * never used as `locationUrl`.
 */
function splitWhat3words(cell: string): { venue: string; w3w?: string } {
  const idx = cell.toLowerCase().indexOf("what3words");
  if (idx === -1) return { venue: cell };
  let venue = cell.slice(0, idx).trim();
  while (venue.endsWith("-")) venue = venue.slice(0, -1).trim();
  const slashes = cell.indexOf("///", idx);
  const w3w = slashes === -1 ? undefined : cell.slice(slashes + 3).trim().split(" ")[0];
  return { venue, w3w: w3w || undefined };
}

function placeholderToUndefined(value: string | undefined): string | undefined {
  if (value === undefined || isPlaceholderCell(value)) return undefined;
  return value;
}

/**
 * Collect the homepage's `Label:` → value pairs from two-cell rows
 * (`<td>Hash No:</td><td>2381</td>`). Only direct-child cells are read: the
 * page nests whole tables inside cells, so a deep `find("td")` would mix rows.
 */
function readLabelledRows($: CheerioAPI): Map<string, string> {
  const fields = new Map<string, string>();
  $("tr").each((_i, tr) => {
    const cells = $(tr).children("td");
    if (cells.length < 2) return;
    const label = clean($(cells[0]).text()).toLowerCase();
    if (!label.endsWith(":") || label.length > 12) return;
    if (!fields.has(label)) fields.set(label, clean($(cells[1]).text()));
  });
  return fields;
}

/** Parse the homepage "next run" block into an event, or null when it is absent/unparseable. */
export function parseNextRun($: CheerioAPI, startTime: string, sourceUrl: string): RawEventData | null {
  const fields = readLabelledRows($);
  const runText = fields.get("hash no:");
  const dateMatch = LONG_DATE_RE.exec(fields.get("date:") ?? "");
  if (!runText || !dateMatch) return null;
  const month = MONTHS[dateMatch[2].toLowerCase()];
  if (!month) return null;
  const date = isoDate(Number.parseInt(dateMatch[3], 10), month, Number.parseInt(dateMatch[1], 10));
  const runNumber = Number.parseInt(runText, 10);
  if (!date || !Number.isFinite(runNumber)) return null;

  const start = splitWhat3words(fields.get("start:") ?? "");
  const onDown = splitWhat3words(fields.get("on down:") ?? "");
  const descriptionParts: string[] = [];
  if (start.w3w) descriptionParts.push(`Start what3words: ///${start.w3w}`);
  const onDownVenue = placeholderToUndefined(onDown.venue);
  if (onDownVenue) descriptionParts.push(`On Down: ${onDownVenue}`);

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    startTime,
    location: placeholderToUndefined(start.venue),
    hares: placeholderToUndefined(fields.get("hares:")),
    description: descriptionParts.length > 0 ? descriptionParts.join("\n") : undefined,
    sourceUrl,
  };
}

/**
 * Parse the forward table rows below the next-run block:
 * `Date | Hash No | Hares | Location | On Down`, dates `DD/MM/YY`.
 */
export function parseForwardRows($: CheerioAPI, startTime: string, sourceUrl: string): RawEventData[] {
  const events: RawEventData[] = [];
  $("tr").each((_i, tr) => {
    const cells = $(tr).children("td").map((_j, td) => clean($(td).text())).get();
    if (cells.length < 5) return;
    const dateMatch = SHORT_DATE_RE.exec(cells[0]);
    if (!dateMatch || !/^\d{3,5}$/.test(cells[1])) return;
    const date = isoDate(
      Number.parseInt(dateMatch[3], 10),
      Number.parseInt(dateMatch[2], 10),
      Number.parseInt(dateMatch[1], 10),
    );
    if (!date) return;
    const onDown = placeholderToUndefined(cells[4]);
    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber: Number.parseInt(cells[1], 10),
      startTime,
      hares: placeholderToUndefined(cells[2]),
      location: placeholderToUndefined(cells[3]),
      description: onDown ? `On Down: ${onDown}` : undefined,
      sourceUrl,
    });
  });
  return events;
}

/** Start time from the "TVH3 runs start at 7.00pm" banner, else 19:00. */
export function parseStartBanner(pageText: string): string {
  const m = START_BANNER_RE.exec(pageText);
  return (m && parse12HourTime(`${m[1]}:${m[2]} ${m[3]}`)) ?? DEFAULT_START_TIME;
}

/**
 * Tamar Valley H3 (Tavistock / West Devon) — weekly Monday 19:00. The legacy
 * MS-Word/FrontPage homepage (tvh3.co.uk) carries a labelled "next run" block
 * plus a short forward table (date, run #, hares, venue, on-down). Pages under
 * /Pages/NextRun.htm are a stale 2020 snapshot and are not read.
 *
 * Forward-only page → `Source.config.upcomingOnly` is required, or reconcile
 * would cancel each run once it drops off the homepage.
 */
export class TamarValleyH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    // iso-8859-1 declared in a <meta> tag only — decode per declaration so "£2" survives.
    const page = await fetchHTMLPage(url, { charsetAware: true });
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const startTime = parseStartBanner(clean($("body").text()));
    const events: RawEventData[] = [];
    const next = parseNextRun($, startTime, url);
    if (next) events.push(next);
    for (const row of parseForwardRows($, startTime, url)) {
      if (!events.some((e) => e.runNumber === row.runNumber)) events.push(row);
    }

    const errors: string[] = [];
    if (!next) {
      // The next-run block is the page's reason to exist; losing it means markup drift.
      errors.push("Tamar Valley H3: homepage next-run block (Hash No / Date) not found — markup may have changed");
    }

    const result: ScrapeResult = {
      events,
      errors,
      structureHash,
      diagnosticContext: { fetchDurationMs, eventsParsed: events.length, nextRunFound: Boolean(next) },
    };
    return applyDateWindow(result, options?.days ?? source.scrapeDays ?? 90);
  }
}
