import type { CheerioAPI } from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchHTMLPage, MONTHS, formatAmPmTime } from "../utils";
import { todayInTimezone } from "@/lib/timezone";

/** Shared constants — exported so the one-shot backfill script stays in sync. */
export const KAMPONG_HOMEPAGE_URL = "https://kampong.hash.org.sg";
export const KAMPONG_KENNEL_TAG = "kampong-h3";
export const KAMPONG_KENNEL_TIMEZONE = "Asia/Singapore";
export const KAMPONG_DEFAULT_START_TIME = "17:30";

/**
 * Kampong H3 (Singapore) adapter.
 *
 * kampong.hash.org.sg publishes two run surfaces on the same homepage:
 *
 * 1. A "Next Run" hero block at the top — rich detail (hares, run site,
 *    on-after venue, exact time):
 *
 *      Next Run / Run 297
 *      Date: Saturday, 16th May 2026 / Run starts 5:30PM
 *      Hares: Horny Pony & Olive Oyl & Shoeless & Durian Dog
 *      Run site: Holland Green Linear Park
 *      On On: Forture Seafood Steam Boat
 *
 * 2. A run archive `<table>` further down (anchored by `<a id="Hareline">`)
 *    listing every run since Run 1 (1999-09-18) plus the next ~7 future
 *    runs. Forward rows carry date + optional free-form details (hare names
 *    or a theme like "300th Run") but no structured fields.
 *
 * The adapter emits current + forward rows only (past archive rows are
 * handled by the one-shot `scripts/backfill-kampong-h3-history.ts` so the
 * adapter stays inside its standard reconcile window).
 */

export interface KampongFields {
  runNumber?: number;
  date?: string;
  startTime?: string;
  hares?: string;
  location?: string;
  onAfter?: string;
}

// Single-pass normalize: collapse NBSPs and runs of whitespace to one space.
const NORMALIZE_WS_RE = /[ \s]+/g;
const RUN_NUMBER_RE = /Run\s+(\d{1,4})/i;
const DATE_RE = /Date:\s*(?:[a-z]+,?\s*)?(\d{1,2})\s*[a-z]*\s+([a-z]+)\s+(\d{4})/i;
const TIME_RE = /(?:Run\s*starts\s*)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i;
// The DOM-aware Next Run collector joins h2 blocks with " | ", so each
// labelled field regex needs " |" as a stop boundary alongside the other
// field markers.
const STOP = String.raw`(?:\s+\||\s+Run\s*site:|\s+Date:|\s+On\s+On:|\s+Hares?:|\s+The\s+Kampong|$)`;
const HARES_RE = new RegExp(`Hares?:\\s*(.+?)${STOP}`, "i");
const RUN_SITE_RE = new RegExp(`Run\\s*site:\\s*(.+?)${STOP}`, "i");
const ON_ON_RE = new RegExp(`On\\s+On:\\s*(.+?)${STOP}`, "i");
const TBA_RE = /^t\.?\s*b\.?\s*a\.?$/i;

/** Parse the "Next Run" text block from kampong.hash.org.sg. */
export function parseKampongNextRun(rawText: string): KampongFields {
  const text = rawText.replaceAll(NORMALIZE_WS_RE, " ").trim();
  const result: KampongFields = {};

  const runMatch = RUN_NUMBER_RE.exec(text);
  if (runMatch) result.runNumber = Number.parseInt(runMatch[1], 10);

  const dateMatch = DATE_RE.exec(text);
  if (dateMatch) {
    const day = Number.parseInt(dateMatch[1], 10);
    const monthIdx = MONTHS[dateMatch[2].toLowerCase()];
    const year = Number.parseInt(dateMatch[3], 10);
    if (monthIdx) {
      result.date = `${year}-${String(monthIdx).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const timeMatch = TIME_RE.exec(text);
  if (timeMatch) {
    const hour = Number.parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? Number.parseInt(timeMatch[2], 10) : 0;
    result.startTime = formatAmPmTime(hour, minute, timeMatch[3]);
  }

  const hareMatch = HARES_RE.exec(text);
  if (hareMatch) result.hares = hareMatch[1].trim();

  const siteMatch = RUN_SITE_RE.exec(text);
  if (siteMatch) {
    const site = siteMatch[1].trim();
    if (!TBA_RE.test(site)) result.location = site;
  }

  const onOnMatch = ON_ON_RE.exec(text);
  if (onOnMatch) {
    const onAfter = onOnMatch[1].trim();
    if (onAfter.length > 0) result.onAfter = onAfter;
  }

  return result;
}

export interface KampongArchiveRow {
  runNumber: number;
  date: string; // YYYY-MM-DD
  detailsRaw?: string; // free-form text after "DD Month YYYY - "
}

/**
 * Diagnostic for a row that COULD have been a run row (numeric first cell)
 * but failed to parse a date. Pure-junk rows without a numeric first cell
 * don't appear here — they're presumed to be table fluff.
 */
export interface KampongArchiveSkip {
  runNumber: number;
  cellText: string;
  reason: "no-leading-date" | "unknown-month";
}

export interface KampongArchiveParseResult {
  rows: KampongArchiveRow[];
  skipped: KampongArchiveSkip[];
}

const ARCHIVE_ROW_RE = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/;
const DETAIL_SEPARATOR_RE = /\s+[-–]\s+/; // " - " or " – " (en-dash)
const CELL_INT_RE = /^(\d{1,4})$/;

function parseArchiveCellDate(
  cell: string,
): { date: string; rest: string } | { date: undefined; reason: "no-leading-date" | "unknown-month" } {
  const m = ARCHIVE_ROW_RE.exec(cell);
  if (!m) return { date: undefined, reason: "no-leading-date" };
  const day = Number.parseInt(m[1], 10);
  const monthIdx = MONTHS[m[2].toLowerCase()];
  const year = Number.parseInt(m[3], 10);
  if (!monthIdx) return { date: undefined, reason: "unknown-month" };
  const date = `${year}-${String(monthIdx).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { date, rest: cell.slice(m[0].length) };
}

function extractDetails(rest: string): string | undefined {
  const sepMatch = DETAIL_SEPARATOR_RE.exec(rest);
  if (!sepMatch) return undefined;
  const tail = rest.slice(sepMatch.index + sepMatch[0].length).replaceAll(NORMALIZE_WS_RE, " ").trim();
  return tail.length > 0 ? tail : undefined;
}

/**
 * Walk the run archive table (anchored by `<a id="Hareline">`) and emit one
 * row per data tr. The header row and rows with no numeric first cell are
 * silently filtered. Numeric-runNumber rows whose date cell fails the
 * leading-date regex are surfaced in `skipped` so callers (live adapter,
 * backfill script) can flag drift instead of treating them as "event
 * disappeared from source".
 */
export function parseKampongArchiveTable($: CheerioAPI): KampongArchiveParseResult {
  const rows: KampongArchiveRow[] = [];
  const skipped: KampongArchiveSkip[] = [];
  const tables = $("table").toArray();
  if (tables.length === 0) return { rows, skipped };
  // Anchor is inside an <h2>; walk the h2's siblings for the run table.
  const anchorParentSibling = $("a#Hareline").parent().nextAll("table").first();
  const tableEl = anchorParentSibling.length > 0 ? anchorParentSibling[0] : tables[0];

  $(tableEl)
    .find("tr")
    .each((_, tr) => {
      const tds = $(tr).find("td");
      if (tds.length < 2) return; // header or stray
      const runMatch = CELL_INT_RE.exec($(tds[0]).text().trim());
      if (!runMatch) return;
      const runNumber = Number.parseInt(runMatch[1], 10);
      const cell = $(tds[1]).text().replaceAll(NORMALIZE_WS_RE, " ").trim();
      const parsed = parseArchiveCellDate(cell);
      if (parsed.date === undefined) {
        skipped.push({ runNumber, cellText: cell, reason: parsed.reason });
        return;
      }
      rows.push({ runNumber, date: parsed.date, detailsRaw: extractDetails(parsed.rest) });
    });
  return { rows, skipped };
}

/**
 * Collect the Next Run "header block" by walking from the `<h1>Next Run…</h1>`
 * heading forward through its `<h2>` siblings until the Hareline anchor. We
 * deliberately drop `<p>` / `<div>` siblings (parking notes, MRT/bus info)
 * so the parser can't absorb that prose into `location`.
 */
function collectNextRunHeaderText($: CheerioAPI): string | null {
  const h1 = $("h1")
    .filter((_, el) => /next\s*run/i.test($(el).text()))
    .first();
  if (h1.length === 0) return null;

  const parts: string[] = [h1.text().trim()];
  let cur = h1.next();
  while (cur.length > 0) {
    const tag = cur.prop("tagName")?.toLowerCase();
    if (tag === "h2") {
      if (cur.find("a#Hareline").length > 0) break;
      parts.push(cur.text().trim());
    }
    cur = cur.next();
  }
  return parts.filter(Boolean).join(" | ");
}

function buildNextRunEvent($: CheerioAPI, sourceUrl: string): {
  event?: RawEventData;
  fields?: KampongFields;
  error?: string;
} {
  const headerText = collectNextRunHeaderText($);
  if (!headerText) return { error: "No 'Next Run' block found on page" };
  const fields = parseKampongNextRun(headerText);
  if (!fields.date) return { error: "Could not parse date from Next Run block", fields };

  const description = fields.onAfter ? `On On: ${fields.onAfter}` : undefined;
  const event: RawEventData = {
    date: fields.date,
    startTime: fields.startTime,
    kennelTags: [KAMPONG_KENNEL_TAG],
    runNumber: fields.runNumber,
    title: fields.runNumber ? `Kampong H3 Run ${fields.runNumber}` : "Kampong H3 Monthly Run",
    hares: fields.hares,
    location: fields.location,
    description,
    sourceUrl,
  };
  return { event, fields };
}

function archiveRowToEvent(row: KampongArchiveRow, sourceUrl: string): RawEventData {
  return {
    date: row.date,
    startTime: KAMPONG_DEFAULT_START_TIME,
    kennelTags: [KAMPONG_KENNEL_TAG],
    runNumber: row.runNumber,
    title: `Kampong H3 Run ${row.runNumber}`,
    description: row.detailsRaw,
    sourceUrl,
  };
}

/** Add N days to a YYYY-MM-DD date string (UTC-safe). */
function addDaysISO(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Fallback when source.scrapeDays is null/0 — matches seed default. */
const DEFAULT_SCRAPE_DAYS = 90;

export class KampongH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || KAMPONG_HOMEPAGE_URL;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { $, structureHash } = page;
    const today = todayInTimezone(KAMPONG_KENNEL_TIMEZONE);
    // Clamp forward emissions to the configured scrape horizon so that
    // archive rows months ahead don't sit outside reconcile's cancellation
    // scope if the kennel later changes them. options.days wins, then
    // source.scrapeDays, then a 90-day default matching the seed.
    const windowDays = options?.days ?? source.scrapeDays ?? DEFAULT_SCRAPE_DAYS;
    const horizon = addDaysISO(today, windowDays);

    const parsed = parseKampongArchiveTable($);
    const byRunNumber = new Map<number, RawEventData>();
    const errors: string[] = [];

    // Seed with archive rows in the [today, today+windowDays] window.
    for (const row of parsed.rows) {
      if (row.date < today) continue;
      if (row.date > horizon) continue;
      byRunNumber.set(row.runNumber, archiveRowToEvent(row, url));
    }

    // Promote skipped rows to scrape errors only when their runNumber
    // could plausibly be in the live window — i.e. >= the earliest emitted
    // run, OR (when nothing emitted) anywhere in the archive. This catches
    // format drift on a live row (e.g. Run 298's date label changes) so
    // reconcile doesn't misread the silent drop as "event removed from
    // source", while ignoring the known historical-archive ambiguities
    // (Run 18 / Feb 2001 etc.) that are out of reconcile scope anyway.
    const emittedRunNumbers = [...byRunNumber.keys()];
    const liveCutoff = emittedRunNumbers.length > 0 ? Math.min(...emittedRunNumbers) : 0;
    for (const skip of parsed.skipped) {
      if (skip.runNumber < liveCutoff) continue;
      errors.push(
        `Archive row ${skip.runNumber} skipped (${skip.reason}): "${skip.cellText}"`,
      );
    }

    // Overlay the Next Run hero block (richer hares/location/on-after).
    const nextRunResult = buildNextRunEvent($, url);
    if (
      nextRunResult.event &&
      nextRunResult.event.date >= today &&
      nextRunResult.event.date <= horizon
    ) {
      const runNumber = nextRunResult.event.runNumber;
      if (runNumber) {
        byRunNumber.set(runNumber, nextRunResult.event);
      } else {
        // Live page always carries a run number; warn loudly if not.
        errors.push("Next Run block parsed but missing run number — skipping overlay");
      }
    } else if (nextRunResult.error) {
      errors.push(nextRunResult.error);
    }

    if (byRunNumber.size === 0) {
      const message = errors[0] ?? "No upcoming events found";
      return { events: [], errors: [message], structureHash };
    }

    const events = [...byRunNumber.values()].sort((a, b) => a.date.localeCompare(b.date));
    return {
      events,
      errors,
      structureHash,
      diagnosticContext: {
        eventsParsed: events.length,
        nextRunNumber: nextRunResult.fields?.runNumber,
        archiveForwardCount: events.length - (nextRunResult.event ? 1 : 0),
        archiveSkippedCount: parsed.skipped.length,
        windowDays,
      },
    };
  }
}
