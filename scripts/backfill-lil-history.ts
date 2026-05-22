/**
 * One-shot historical backfill for LIL (Long Island Lunatics) — issue #1603.
 *
 * hashnyc.com exposes a `?days=N&backwards=true` archive query that walks
 * every past row (~4,400 back to 2012). The live HashNYC adapter uses
 * `days=90` and hard-filters `year < 2016` (hashnyc.ts:506), so LIL #1–#49
 * (May 2012 → Apr 2016) never enter the pipeline through recurring scrapes.
 *
 * This script does a one-shot fetch with `days=10000`, reuses the live
 * row parser minus the year guard, filters to `kennelTag === "lil"`, and
 * routes the past slice through the merge pipeline. The backfill runner
 * applies strict date partitioning (`date < today` only), so this never
 * collides with the recurring scrape's upcoming window. Re-runnable:
 * `processRawEvents` short-circuits on existing fingerprints.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-lil-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-lil-history.ts
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import {
  decodeHtmlEntities,
  extractHares,
  extractMonthDay,
  extractSourceUrl,
  extractTime,
  extractYear,
  parseDetailsCell,
} from "@/adapters/html-scraper/hashnyc";
import { safeFetch } from "@/adapters/safe-fetch";
import type { RawEventData } from "@/adapters/types";
import { runBackfillScript } from "./lib/backfill-runner";

const SOURCE_NAME = "HashNYC Website";
const BASE_URL = "https://hashnyc.com";
const ARCHIVE_URL = `${BASE_URL}/?days=10000&backwards=true`;
const KENNEL_TAG = "lil";
const KENNEL_TIMEZONE = "America/New_York";

/**
 * Parse hashnyc archive rows into RawEventData[]. Mirrors the past-events
 * branch of `parseRows` in src/adapters/html-scraper/hashnyc.ts — minus the
 * `year < 2016` filter that would silently drop every pre-2016 LIL row.
 *
 * Exported for unit testing against fixture HTML.
 */
export function parseArchiveRows(html: string, baseUrl: string): RawEventData[] {
  const $ = cheerio.load(html);
  const rows = $("table.past_hashes tr");
  const events: RawEventData[] = [];

  rows.each((_i, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) return;

    const dateCellHtml = cells.eq(0).html() ?? "";
    const dateCellText = decodeHtmlEntities(dateCellHtml);

    const rowId = $(row).attr("id") ?? undefined;
    const year = extractYear(rowId, dateCellHtml);
    if (!year) return;

    const monthDay = extractMonthDay(dateCellText);
    if (!monthDay) return;

    const eventDate = new Date(
      Date.UTC(year, monthDay.month, monthDay.day, 12, 0, 0),
    );
    const dateStr = eventDate.toISOString().split("T")[0];

    const parsed = parseDetailsCell($, cells.eq(1));
    if (parsed.kennelTag !== KENNEL_TAG) return;

    const rawHares = extractHares($, row);
    const hares =
      rawHares && rawHares !== "N/A" && !/sign up to hare/i.test(rawHares)
        ? rawHares
        : undefined;

    events.push({
      date: dateStr,
      kennelTags: [parsed.kennelTag],
      runNumber: parsed.runNumber,
      title: parsed.title,
      description: parsed.description,
      hares,
      location: parsed.location,
      locationUrl: parsed.locationUrl,
      startTime: extractTime(dateCellText),
      sourceUrl: extractSourceUrl($, row, baseUrl),
    });
  });

  return events;
}

async function fetchEvents(): Promise<RawEventData[]> {
  console.log(`  Fetching ${ARCHIVE_URL}...`);
  const response = await safeFetch(ARCHIVE_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const html = await response.text();
  console.log(`  Downloaded ${(html.length / 1024).toFixed(0)} KB`);
  return parseArchiveRows(html, BASE_URL);
}

if (process.argv[1]?.endsWith("backfill-lil-history.ts")) {
  runBackfillScript({
    sourceName: SOURCE_NAME,
    kennelTimezone: KENNEL_TIMEZONE,
    label: `Walking ${ARCHIVE_URL} for LIL rows`,
    fetchEvents,
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("FAILED:", message);
    process.exit(1);
  });
}
