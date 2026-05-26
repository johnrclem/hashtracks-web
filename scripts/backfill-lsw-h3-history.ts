/**
 * One-shot historical backfill for LSW (Little Sai Wan H3, Hong Kong) —
 * issue #1611.
 *
 * The live source (`/lsw/hareline.htm`) is upcoming-only. The same site
 * ships `/lsw/previousruns.htm` — a single static HTML table with every
 * recorded run back to the kennel's founding (LSW #1, 17 Jan 1979). Issue
 * #1611 framed the floor as #100 but the founding run is in the same table
 * (sparse rows for 1979-82, dense from 1983 onward).
 *
 * This script does a one-shot fetch with realistic browser headers
 * (server uses mod_security and rejects default Accept headers), decodes
 * windows-1252 (page declares it explicitly; default UTF-8 corrupts
 * accented hash names like "Prefers it�Wet"), and routes every parsable
 * row through the backfill runner's strict-partitioning merge.
 *
 * Yield estimate: ~1,584 events (1979 → today). Re-runnable: the runner
 * partitions to `date < today (Asia/Hong_Kong)` and `processRawEvents`
 * short-circuits on existing fingerprints.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-lsw-h3-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-lsw-h3-history.ts
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { safeFetch } from "@/adapters/safe-fetch";
import { parseLswDate } from "@/adapters/html-scraper/lsw-h3";
import { decodeEntities } from "@/adapters/utils";
import type { RawEventData } from "@/adapters/types";
import { runBackfillScript } from "./lib/backfill-runner";

const SOURCE_NAME = "LSW Hareline";
const BASE_URL = "https://www.datadesignfactory.com/lsw";
const ARCHIVE_URL = `${BASE_URL}/previousruns.htm`;
const KENNEL_TAG = "lsw-h3";
const KENNEL_TIMEZONE = "Asia/Hong_Kong";

/** Browser-realistic headers — mod_security rejects empty / default Accept. */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.5",
};

/** Sort comma-separated hare names so re-runs produce identical fingerprints.
 * Source row order is API-dependent and not guaranteed stable across scrapes
 * (per feedback_fingerprint_stability.md). Exported for unit testing. */
export function normalizeHares(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const tokens = trimmed
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return undefined;
  return [...tokens].sort((a, b) => a.localeCompare(b, "en")).join(", ");
}

/** Parse one TR row into RawEventData, or null when the row doesn't carry
 * a usable date + run number. The HTML is a header-less table with five
 * `<td>` columns: DATE, RUN NO. (anchored to detail page), LOCATION, HARES,
 * RUNNERS. Header rows have the literal text "DATE" in the first cell.
 *
 * Exported for unit testing against fixture HTML.
 */
export function parseLswArchiveRow(
  $: cheerio.CheerioAPI,
  row: AnyNode,
  baseUrl: string,
): RawEventData | null {
  const $row = $(row);
  const cells = $row.find("td");
  if (cells.length < 4) return null;

  const dateText = decodeEntities($(cells[0]).text()).trim();
  // Header row guard: first row of the table is literal "DATE".
  if (/^date$/i.test(dateText)) return null;

  const date = parseLswDate(dateText);
  if (!date) return null;

  // Run number — prefer anchor text; fall back to raw cell text. Skip rows
  // with no run number at all (the archive has a handful of 1990-91 entries
  // without numbers).
  const $runCell = $(cells[1]);
  const runAnchor = $runCell.find("a").first();
  const runText = (runAnchor.length > 0 ? runAnchor.text() : $runCell.text()).trim();
  const runDigits = runText.replace(/\D/g, "");
  if (!runDigits) return null;
  const runNumber = parseInt(runDigits, 10);
  if (!runNumber || runNumber <= 0) return null;

  const locationRaw = decodeEntities($(cells[2]).text()).trim();
  const location = locationRaw || undefined;

  const haresRaw = decodeEntities($(cells[3]).text()).trim();
  const hares = normalizeHares(haresRaw);

  // Runners → "Pack: NN" in description. Skip when not a positive integer.
  const runnersRaw = cells.length > 4 ? $(cells[4]).text().trim() : "";
  const runnersNum = parseInt(runnersRaw, 10);
  const description = Number.isFinite(runnersNum) && runnersNum > 0
    ? `Pack: ${runnersNum}`
    : undefined;

  // sourceUrl: derive from the anchor href if present, otherwise the archive page.
  const href = runAnchor.attr("href")?.trim();
  const sourceUrl = href
    ? new URL(href, `${baseUrl}/`).toString()
    : ARCHIVE_URL;

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    // title left undefined — merge pipeline synthesizes "LSW Trail #N".
    hares,
    location,
    description,
    // startTime intentionally undefined — historical archive doesn't carry
    // per-run times; D14 atomic semantics preserve whatever the live adapter
    // emits rather than asserting a stale default.
    sourceUrl,
  };
}

/** Parse the full previousruns.htm body. Exported for unit testing. */
export function parseLswArchiveBody(html: string): RawEventData[] {
  const $ = cheerio.load(html);
  const events: RawEventData[] = [];
  $("tr").each((_i, row) => {
    const event = parseLswArchiveRow($, row, BASE_URL);
    if (event) events.push(event);
  });
  return events;
}

/** Fetch + decode the windows-1252 archive page. */
async function fetchEvents(): Promise<RawEventData[]> {
  console.log(`  Fetching ${ARCHIVE_URL}...`);
  const response = await safeFetch(ARCHIVE_URL, { headers: BROWSER_HEADERS });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  // Source declares <META charset="windows-1252">. Decode explicitly —
  // default fetch().text() treats bytes as UTF-8 and corrupts accented
  // hash names ("Prefers it Wet" → "Prefers it�Wet"). Built-in TextDecoder
  // handles windows-1252 natively; no extra dep needed.
  const buf = await response.arrayBuffer();
  const html = new TextDecoder("windows-1252").decode(new Uint8Array(buf));
  console.log(`  Downloaded ${(buf.byteLength / 1024).toFixed(0)} KB (decoded windows-1252)`);
  return parseLswArchiveBody(html);
}

if (process.argv[1]?.endsWith("backfill-lsw-h3-history.ts")) {
  runBackfillScript({
    sourceName: SOURCE_NAME,
    kennelTimezone: KENNEL_TIMEZONE,
    label: `Walking ${ARCHIVE_URL} for LSW historical rows`,
    fetchEvents,
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("FAILED:", message);
    process.exit(1);
  });
}
