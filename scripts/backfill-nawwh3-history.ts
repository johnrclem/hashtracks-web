/**
 * One-shot historical backfill for NAWW H3 (New Amsterdam Weekend Wankers,
 * NYC) run #1–#74 — the 1997-1998 through 2001-2002 "Winter Wednesday" seasons
 * (#1857).
 *
 * `nawwh3` stores events from #75 (9 Oct 2002) forward. The source NAWW area
 * page enumerates the earlier archive in five season writeup tables
 * (Date | Run No. | Start and On On | Hare(s) | Scribe). The live HashNYC
 * adapter only reads the receding hareline (next 30 days), so this archive
 * never reaches the merge pipeline through normal scraping — load it once here.
 *
 * Per `feedback_historical_backfill`: deep-dive history goes in via a one-shot
 * script, partitioned `date < today` so it can never collide with the live
 * adapter's upcoming rows. Routes through `reportAndApplyBackfill`, bound to
 * the "HashNYC Website" source (linked to `nawwh3`), so canonical Events are
 * created in the same pass — no orphan RawEvents.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-nawwh3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-nawwh3-history.ts
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import { runBackfillScript } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import { decodeEntities, stripHtmlTags, MONTHS } from "@/adapters/utils";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "HashNYC Website";
const KENNEL_TIMEZONE = "America/New_York";
const KENNEL_TAG = "nawwh3";
const ARCHIVE_URL = "https://hashnyc.com/area-hashes/naww-h3/";
const SECTION_MARKER = "Winter Wednesday Hash Writeups";
const START_TIME = "19:00"; // era-historical biweekly Wednesday 7 PM
const MAX_ARCHIVE_RUN = 74;

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Parse the two date formats the archive uses: "10/22/1997" and "Oct 10, 2001".
 * A few cells carry source uncertainty ("3/18/1998 or 3/25/1998?"); fall back
 * to the FIRST date token rather than dropping the run entirely.
 */
function parseArchiveDate(raw: string): string | null {
  const text = collapse(raw);
  const named = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (named) {
    const month = MONTHS[named[1].slice(0, 3).toLowerCase()];
    if (!month) return null;
    return `${named[3]}-${pad(month)}-${pad(Number(named[2]))}`;
  }
  // Anchored M/D/YYYY, else the first M/D/YYYY token anywhere in the cell.
  const slash = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (slash) {
    return `${slash[3]}-${pad(Number(slash[1]))}-${pad(Number(slash[2]))}`;
  }
  return null;
}

/** Hare cell → name string, dropping archive placeholders. */
function cleanHare(raw: string): string | undefined {
  const text = collapse(raw);
  if (!text) return undefined;
  if (/^(tbd|tba|pending|n\/?a|unknown)\b/i.test(text)) return undefined;
  if (/^\(.*\)$/.test(text)) return undefined; // "(pending)", "(committee)"
  return text;
}

/** "Start: X <br> On In: Y" cell → venue + on-in note (tolerates the "OOn In" typo). */
function parseStartOnIn(cellHtml: string): { location?: string; description?: string } {
  const text = stripHtmlTags(decodeEntities(cellHtml.replace(/<br\s*\/?>/gi, "\n")));
  // `[ \t]*` (not `\s*`) so the capture stops at the line break — otherwise an
  // empty "Start:\nOn In:" cell would let Start swallow the On-In line.
  const startMatch = /Start:[ \t]*([^\n]*)/i.exec(text);
  const onInMatch = /O?On[ \t]*In:[ \t]*([^\n]*)/i.exec(text);
  const location = startMatch ? collapse(startMatch[1]) : "";
  const onIn = onInMatch ? collapse(onInMatch[1]) : "";
  return {
    location: location || undefined,
    description: onIn ? `On-In: ${onIn}` : undefined,
  };
}

export function parseNawwArchive(html: string): RawEventData[] {
  const sectionStart = html.indexOf(SECTION_MARKER);
  if (sectionStart === -1) {
    throw new Error(`Archive section "${SECTION_MARKER}" not found — page structure changed.`);
  }
  const $ = cheerio.load(html.slice(sectionStart));
  const events: RawEventData[] = [];
  const seen = new Set<number>();

  $("tr").each((_, tr) => {
    // `.children`, not `.find`: the source HTML is malformed (unclosed tags),
    // so cheerio also synthesises a giant wrapper <tr> whose descendant-`td`
    // set spans a whole season. Restricting to DIRECT cells skips those
    // wrappers (1 child) and keeps only the real 5-column data rows.
    const cells = $(tr).children("td");
    if (cells.length < 5) return; // header / index / layout / wrapper rows
    const runNumber = Number.parseInt(collapse(cells.eq(1).text()), 10);
    if (!Number.isInteger(runNumber) || runNumber < 1 || runNumber > MAX_ARCHIVE_RUN) return;
    if (seen.has(runNumber)) return;
    const date = parseArchiveDate(cells.eq(0).text());
    if (!date) return;
    seen.add(runNumber);

    const { location, description } = parseStartOnIn(cells.eq(2).html() ?? "");
    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber,
      hares: cleanHare(cells.eq(3).text()),
      location,
      description,
      startTime: START_TIME,
      sourceUrl: ARCHIVE_URL,
    });
  });

  if (events.length === 0) {
    throw new Error("No NAWW archive rows parsed — table structure may have changed.");
  }
  return events;
}

async function fetchEvents(): Promise<RawEventData[]> {
  const res = await safeFetch(ARCHIVE_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)" },
  });
  if (!res.ok) {
    throw new Error(`Archive fetch failed: HTTP ${res.status} ${res.statusText}`);
  }
  return parseNawwArchive(await res.text());
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Parsing hashnyc.com NAWW Winter Wednesday writeup archive (#1–#74)",
  fetchEvents,
}).catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
