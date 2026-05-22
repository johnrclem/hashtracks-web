/**
 * Partial historical backfill for LBH-PHX (Phoenix Lost Boobs Hash) — issue
 * #1595.
 *
 * Findings from source reconnaissance:
 *   - The live ICS feed (`?plugin=events-manager&page=events.ics`) is
 *     upcoming-only — no `scope=past` support.
 *   - WordPress REST API (`/wp-json/...`) is disabled / 404.
 *   - The wp-events-manager Big Ass Calendar at `?page_id=21` accepts
 *     month-navigation params `?page_id=21&mo=M&yr=YYYY` (confirmed by
 *     inspecting the calendar's `em-calnav-prev` / `em-calnav-next`
 *     anchors — the `calendar=YYYY-M` form is silently ignored).
 *   - The plugin's database only carries LBH events back to ~2023. Earlier
 *     years return empty calendar grids — the pre-2023 archive is not
 *     reachable from the public site. Filling that gap would require a
 *     WP admin CSV export from the LBH kennel (left as a follow-up).
 *
 * What this script does fetch:
 *   - Calendar pages from 2023-01 → today (the reachable window).
 *   - For each LBH anchor `<a href="...?event=<slug>" title="LBH #N: …">D</a>`
 *     extract slug, runNumber, hash-name (title), and day. Compose date
 *     with the URL's year/month.
 *   - Dedup by slug, accounting for calendar grid spillover. Each LBH
 *     event appears in two months' grids (canonical + previous- or next-
 *     month spillover) — see `pickCanonicalSighting` below.
 *   - Pass 2: for each unique slug, fetch the detail page in concurrent
 *     batches of 5 with a 250 ms inter-batch delay. Parse the entry-
 *     content text for `Hare(s):`, `Where:`, `Hash Cash:`, and start time.
 *     Best-effort — missing regex matches emit `undefined` (preserve
 *     whatever the recurring ICS adapter already populated), not `null`
 *     (which would overwrite-clear).
 *
 * Yield estimate: ~120-150 events reachable (2023-01 → today). Of those,
 * ~60 are already in HashTracks via the live ICS adapter; the merge
 * pipeline dedupes by fingerprint, so the net gain is ~80-90 new events.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-lbh-phx-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-lbh-phx-history.ts
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import { safeFetch } from "@/adapters/safe-fetch";
import { decodeEntities, parse12HourTime } from "@/adapters/utils";
import type { RawEventData } from "@/adapters/types";
import { runBackfillScript } from "./lib/backfill-runner";

// Bind to the HTML_SCRAPER source (`?page_id=21` Big Ass Calendar, trust=8)
// rather than the ICS feed (trust=7) — the calendar IS the page this script
// scrapes. Keeps provenance honest and lets the merge pipeline apply the
// correct per-field trust resolution against the recurring ICS rows.
const SOURCE_NAME = "Phoenix H3 Big Ass Calendar";
const BASE_URL = "https://www.phoenixhhh.org";
const KENNEL_TAG = "lbh-phx";
const KENNEL_TIMEZONE = "America/Phoenix";

const ARCHIVE_START_YEAR = 2023;
const ARCHIVE_START_MONTH = 1;
const POLITENESS_DELAY_MS = 250;
const DETAIL_CONCURRENCY = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Anchor sighting from a calendar page. */
interface Sighting {
  slug: string;
  runNumber: number;
  title: string;
  day: number;
  yr: number;
  mo: number;
}

/** Parse one calendar month's HTML for LBH anchors.
 *
 * Exported for unit testing. */
export function parseCalendarPage(
  html: string,
  yr: number,
  mo: number,
): Sighting[] {
  const $ = cheerio.load(html);
  const out: Sighting[] = [];
  // Key on title ("LBH #N…"), not slug prefix — handles legacy/typo slugs
  // like `?event=bh-706-…` where the post slug drifted from the canonical
  // `lbh-` prefix.
  $('a[href*="?event="]').each((_i, el) => {
    const $a = $(el);
    const dayText = $a.text().trim();
    if (!/^\d{1,2}$/.test(dayText)) return; // skip "More Info" + title-line dupes
    const title = decodeEntities($a.attr("title") ?? "");
    const runMatch = /^LBH\s+#?(\d+)/.exec(title);
    if (!runMatch) return; // only keep anchors whose title is a real LBH #N event
    const slug = ($a.attr("href")?.match(/[?&]event=([^&"'#]+)/) ?? ["", ""])[1];
    if (!slug) return;
    out.push({
      slug,
      runNumber: Number.parseInt(runMatch[1], 10),
      title: title.replace(/^LBH\s+#?\d+(?::\s*|\s*[-–]\s*)?/, "").trim() || title,
      day: Number.parseInt(dayText, 10),
      yr,
      mo,
    });
  });
  return out;
}

/** Calendar grid spillover dedup. Each LBH event renders in two months'
 * grids: the canonical month + the adjacent month (previous-trailing or
 * next-leading).
 *
 *   - day in [8, 21] → mid-month, only one sighting exists, take it.
 *   - day ≤ 7        → canonical is the LATER (yr, mo); the earlier one is
 *                       the next-month-leading spillover.
 *   - day ≥ 22       → canonical is the EARLIER (yr, mo); the later one is
 *                       the previous-month-trailing spillover.
 *
 * Exported for unit testing. */
export function pickCanonicalSighting(sightings: Sighting[]): Sighting {
  if (sightings.length === 1) return sightings[0];
  const middle = sightings.find((s) => s.day >= 8 && s.day <= 21);
  if (middle) return middle;
  const sorted = [...sightings].sort((a, b) =>
    a.yr === b.yr ? a.mo - b.mo : a.yr - b.yr,
  );
  return sorted[0].day <= 7 ? sorted.at(-1)! : sorted[0];
}

/** Strip HTML, decode entities, collapse whitespace. Suitable for
 * applying field regexes against the entry-content paragraph block. */
function entryContentText(html: string): string {
  const $ = cheerio.load(html);
  const entry =
    $(".entry-content").first().text() ||
    $("article").first().text() ||
    $("main").text();
  return decodeEntities(entry).replaceAll(/\s+/g, " ").trim();
}

/** Section labels in the wp-events-manager entry-content template. Each
 * field's value runs from its own label up to whichever of these comes
 * next. Listed as plain strings (not a regex alternation) to keep the
 * field extraction below S5843's regex-complexity bound. */
const SECTION_LABELS = [
  "Who:", "What:", "Where:", "Why:", "When:",
  "Wear:", "Theme:", "Bring:", "Dog-Friendly", "Dog Friendly",
  "On-after", "On after", "Hash Cash:", "NOTE:",
  "On-safety", "On safety", "Categories",
] as const;

/** Date(s) line has NO space between year and start time —
 * `05/25/20266:30 pm` — so the year→time gap is `\s*` not `\s+`. */
const TIME_RE = /Date\(s\)\s*-\s*\w+\s*-\s*\d{1,2}\/\d{1,2}\/\d{4}\s*(\d{1,2}:\d{2}\s*[ap]m)/i;

/** Index of the next section label at or after `from`, or `text.length`. */
function findNextSectionStart(text: string, from: number): number {
  let next = text.length;
  for (const label of SECTION_LABELS) {
    const idx = text.indexOf(label, from);
    if (idx !== -1 && idx < next) next = idx;
  }
  return next;
}

/** Extract the value of a labeled field (tries each `label` in order).
 * Returns the trimmed text between the label and the next section start,
 * or `undefined` if no label matches. */
function extractField(text: string, labels: readonly string[]): string | undefined {
  for (const label of labels) {
    const start = text.indexOf(label);
    if (start === -1) continue;
    const valueStart = start + label.length;
    const valueEnd = findNextSectionStart(text, valueStart);
    const value = text.slice(valueStart, valueEnd).trim();
    if (value) return value;
  }
  return undefined;
}

interface DetailFields {
  startTime: string | undefined;
  hares: string | undefined;
  location: string | undefined;
  cost: string | undefined;
}

/** Parse a single detail page's entry-content. A regex MISS emits
 * `undefined` (preserve-existing) rather than `null` (explicit-clear) — the
 * source doesn't *assert* the field is blank, the parser just didn't find
 * it. Letting the merge layer keep whatever the recurring ICS adapter
 * already populated. Exported for unit testing. */
export function parseDetailPage(html: string): DetailFields {
  const text = entryContentText(html);

  const timeMatch = TIME_RE.exec(text);
  const startTime = timeMatch ? parse12HourTime(timeMatch[1]) ?? undefined : undefined;

  const hares = extractField(text, ["Hare(s):", "Hares:", "Hare:"]);
  const location = extractField(text, ["Where:"]);

  // Cost section often runs into prose ("Please arrive on time…"). Trim
  // to the first sentence so the UI shows just the price line.
  const costRaw = extractField(text, ["Hash Cash:"]);
  const cost = costRaw?.split(/\.\s+/)[0]?.trim() || undefined;

  return { startTime, hares, location, cost };
}

async function fetchHtml(url: string): Promise<string | null> {
  const response = await safeFetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)" },
  });
  if (!response.ok) return null;
  return response.text();
}

function* iterMonths(startYear: number, startMonth: number, endYear: number, endMonth: number) {
  for (let yr = startYear; yr <= endYear; yr++) {
    const moStart = yr === startYear ? startMonth : 1;
    const moEnd = yr === endYear ? endMonth : 12;
    for (let mo = moStart; mo <= moEnd; mo++) yield { yr, mo };
  }
}

/** Pass 1: walk calendar pages, collect raw sightings keyed by slug. */
async function walkCalendarPages(endYear: number, endMonth: number): Promise<Map<string, Sighting[]>> {
  const sightingsBySlug = new Map<string, Sighting[]>();
  let pagesFetched = 0;
  let pagesEmpty = 0;
  for (const { yr, mo } of iterMonths(ARCHIVE_START_YEAR, ARCHIVE_START_MONTH, endYear, endMonth)) {
    pagesFetched++;
    const html = await fetchHtml(`${BASE_URL}/?page_id=21&mo=${mo}&yr=${yr}`);
    const sightings = html ? parseCalendarPage(html, yr, mo) : [];
    if (sightings.length === 0) pagesEmpty++;
    for (const s of sightings) {
      const arr = sightingsBySlug.get(s.slug) ?? [];
      arr.push(s);
      sightingsBySlug.set(s.slug, arr);
    }
    await sleep(POLITENESS_DELAY_MS);
  }
  console.log(
    `  Pass 1: ${pagesFetched} calendar pages fetched (${pagesEmpty} empty), ${sightingsBySlug.size} unique LBH slugs`,
  );
  return sightingsBySlug;
}

/** Pass 2: fetch each canonical sighting's detail page, returning per-slug
 * enrichment fields. Concurrent batches of `DETAIL_CONCURRENCY` with a
 * politeness delay between batches. Errors are non-fatal. */
async function enrichDetailPages(canonical: Sighting[]): Promise<Map<string, DetailFields>> {
  const detailsBySlug = new Map<string, DetailFields>();
  let detailsFetched = 0;
  let detailErrors = 0;
  for (let i = 0; i < canonical.length; i += DETAIL_CONCURRENCY) {
    const batch = canonical.slice(i, i + DETAIL_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(fetchDetail));
    for (const r of results) {
      detailsFetched++;
      if (r.status === "fulfilled") detailsBySlug.set(r.value.slug, r.value.fields);
      else detailErrors++;
    }
    await sleep(POLITENESS_DELAY_MS);
  }
  console.log(
    `  Pass 2: ${detailsFetched} detail pages fetched, ${detailErrors} errors, ${detailsBySlug.size} enriched`,
  );
  return detailsBySlug;
}

async function fetchDetail(s: Sighting): Promise<{ slug: string; fields: DetailFields }> {
  const url = `${BASE_URL}/?event=${s.slug}`;
  const html = await fetchHtml(url);
  if (!html) throw new Error(`HTTP error fetching ${url}`);
  return { slug: s.slug, fields: parseDetailPage(html) };
}

/** Compose a `RawEventData` row from a canonical sighting + its (optional)
 * detail-page enrichment. Missing detail fields stay `undefined` to preserve
 * whatever the recurring ICS adapter already populated. */
function buildRawEvent(s: Sighting, details: DetailFields | undefined): RawEventData {
  const date = new Date(Date.UTC(s.yr, s.mo - 1, s.day, 12, 0, 0)).toISOString().slice(0, 10);
  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber: s.runNumber,
    title: s.title,
    hares: details?.hares,
    location: details?.location,
    startTime: details?.startTime,
    cost: details?.cost,
    sourceUrl: `${BASE_URL}/?event=${s.slug}`,
  };
}

async function fetchEvents(): Promise<RawEventData[]> {
  const now = new Date();
  const sightingsBySlug = await walkCalendarPages(now.getUTCFullYear(), now.getUTCMonth() + 1);
  const canonical = [...sightingsBySlug.values()].map(pickCanonicalSighting);
  const detailsBySlug = await enrichDetailPages(canonical);
  return canonical.map((s) => buildRawEvent(s, detailsBySlug.get(s.slug)));
}

if (process.argv[1]?.endsWith("backfill-lbh-phx-history.ts")) {
  runBackfillScript({
    sourceName: SOURCE_NAME,
    kennelTimezone: KENNEL_TIMEZONE,
    label: `Walking phoenixhhh.org calendar ${ARCHIVE_START_YEAR}-01 → today for LBH events`,
    fetchEvents,
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("FAILED:", message);
    process.exit(1);
  });
}
