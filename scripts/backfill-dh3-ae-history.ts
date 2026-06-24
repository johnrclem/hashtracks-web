/**
 * One-shot historical backfill for Desert Hash House Harriers (Dubai) — dh3-ae.
 *
 * The recurring DesertHashAdapter pulls only the rolling window: the home MEC
 * card (upcoming) + the Hare Line agenda (last ~50 runs, date/time/run# only, NO
 * venue). Everything older lives in the legacy WordPress blog posts under
 * `?cat=3` ("DH3 Runs"), which — uniquely — carry the VENUE in the post title:
 *
 *   <h3><a href="?p=NNNN">Run NNNN – 29th August 2021 – Kickers Sports Bar</a></h3>
 *   <div class="excerpt"><p>Date: Sunday 29th August 2021 Time: 18:30 Run No: 2205 Location: …</p></div>
 *
 * This script walks the paginated `?cat=3&paged=N` archive and routes the parsed
 * runs through the live merge pipeline (`runBackfillScript` → `reportAndApplyBackfill`
 * → `processRawEvents`), which creates RawEvents AND upserts canonical Events in
 * one pass. (Pre-inserting RawEvents and "triggering a scrape" does NOT merge
 * them — `scrapeSource` only processes the live adapter's fetch results. See
 * `scripts/lib/backfill-runner.ts`.) Idempotent: re-runs dedupe by fingerprint,
 * and an orphaned RawEvent from a prior direct-insert run is adopted + linked.
 *
 * Partition (handled by `reportAndApplyBackfill`, Asia/Dubai): only `date < today`
 * is merged; the adapter owns `date >= today`. The two never overlap.
 *
 * STRAY-SERIES GUARD: the archive interleaves a *different* low-numbered series
 * with the main 4-digit DH3 sequence — the COVID-era "Virtual DH3" runs #1–22
 * (Mar 2020 – Jan 2021), online socials, not numbered DH3 trails. Any run number
 * below MAIN_SERIES_MIN is excluded (and logged). The real `?cat=3` trail series
 * stays in the ~2055–2205 band (May 2018 – Aug 2021). (A "Run 304" also appears
 * in the page's sidebar "recent posts" widget, not as a main post title, so the
 * h3/h2-title selector never picks it up.)
 *
 * TITLE: left undefined so the merge pipeline synthesizes "Desert H3 Trail #N"
 * (never set title = venue/hares — see the title-fallback rule).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-dh3-ae-history.ts
 *   Execute:  BACKFILL_APPLY=1 BACKFILL_ALLOW_SELF_SIGNED_CERT=1 \
 *               npx tsx scripts/backfill-dh3-ae-history.ts
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import { runBackfillScript } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import { chronoParseDate } from "@/adapters/utils";
import { parseClock } from "@/adapters/html-scraper/desert-hash";
import type { RawEventData } from "@/adapters/types";

const KENNEL_TAG = "dh3-ae";
const SOURCE_NAME = "Desert H3 Website";
const KENNEL_TIMEZONE = "Asia/Dubai";
const ARCHIVE_BASE = "https://www.deserthash.org/?cat=3";
const ARCHIVE_ORIGIN = "https://www.deserthash.org";
const MAX_PAGES = 30; // ~9 real pages today; generous safety cap against runaway walks
const MAIN_SERIES_MIN = 1000; // exclude the stray "Virtual DH3" #1–22 sub-series
const FETCH_DELAY_MS = 500;
const USER_AGENT = "Mozilla/5.0 (compatible; HashTracksBackfill/1.0; +https://hashtracks.com)";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url: string): Promise<string> {
  const res = await safeFetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Fetch ${url} failed: HTTP ${res.status}`);
  return res.text();
}

/**
 * Parse one "DH3 Runs" blog post into a RawEventData. Title carries
 * `Run NNNN – <date> – <venue>`; the excerpt carries `Time: HH:MM`. Segments
 * split on a *space-surrounded* dash/hyphen, so hyphenated venue names
 * ("Al-Habtoor") stay intact while WP posts that use " - " separate correctly.
 * Returns null when it isn't a parseable run post.
 */
export function parseWpRunPost(
  titleText: string,
  excerptText: string | undefined,
  href: string | undefined,
): RawEventData | null {
  const text = titleText.replace(/\s+/g, " ").trim();
  const runM = /^Run\s+(\d+)\b/i.exec(text);
  if (!runM) return null;
  const runNumber = Number.parseInt(runM[1], 10);

  // `text` is already whitespace-collapsed to single spaces above, so split on
  // a literal single-spaced dash/hyphen — no `\s+` quantifier (avoids regex
  // backtracking) while keeping hyphenated venue names ("Al-Habtoor") intact.
  const segs = text.split(/ [–—-] /);
  const dateText = segs[1]?.trim() ?? "";
  const date = chronoParseDate(dateText, "en-GB");
  if (!date) return null;

  const venue = segs.slice(2).join(" – ").trim() || undefined;
  const startTime = parseClock(/Time:\s*(\d{1,2}:\d{2})/i.exec(excerptText ?? "")?.[1]);

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    // title intentionally omitted → merge synthesizes "Desert H3 Trail #N"
    location: venue,
    startTime,
    sourceUrl: href || ARCHIVE_BASE,
  };
}

interface ParsedPost {
  event: RawEventData;
  runNumber: number;
}

/** Parse every "DH3 Runs" post on one archive listing page. */
function parsePage(html: string): ParsedPost[] {
  const $ = cheerio.load(html);
  const out: ParsedPost[] = [];
  $("h3 a, h2 a").each((_i, el) => {
    const $a = $(el);
    const href = $a.attr("href") ?? undefined;
    // Keep on-site links only — tolerant of http/https and the optional www.
    // subdomain (older WP installs); relative (`/`, `?`) links are on-site too.
    const isLocal = !href || href.startsWith("/") || href.startsWith("?") ||
      /^https?:\/\/(?:www\.)?deserthash\.org/i.test(href);
    if (!isLocal) return;
    const titleText = $a.text();
    if (!/^\s*Run\s+\d+/i.test(titleText)) return;
    // The excerpt div is the next element sibling of the <h3>.
    const excerpt = $a.closest("h3, h2").nextAll(".excerpt").first().text();
    const event = parseWpRunPost(titleText, excerpt, href ? new URL(href, ARCHIVE_ORIGIN).toString() : undefined);
    if (event?.runNumber != null) out.push({ event, runNumber: event.runNumber });
  });
  return out;
}

/** Add posts not already seen (by run number) to `byRun`; return how many were new. */
function mergeNewPosts(byRun: Map<number, ParsedPost>, posts: ParsedPost[]): number {
  let added = 0;
  for (const p of posts) {
    if (!byRun.has(p.runNumber)) {
      byRun.set(p.runNumber, p);
      added++;
    }
  }
  return added;
}

async function fetchArchive(): Promise<ParsedPost[]> {
  const byRun = new Map<number, ParsedPost>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = page === 1 ? ARCHIVE_BASE : `${ARCHIVE_BASE}&paged=${page}`;
    let posts: ParsedPost[];
    try {
      posts = parsePage(await fetchText(url));
    } catch (err) {
      console.log(`  page ${page}: fetch error (${err instanceof Error ? err.message : String(err)}) — stopping walk`);
      break;
    }
    if (posts.length === 0) {
      console.log(`  page ${page}: 0 run posts — end of archive`);
      break;
    }
    const added = mergeNewPosts(byRun, posts);
    console.log(`  page ${page}: ${posts.length} posts (${added} new) — runs ${posts.at(-1)?.runNumber}–${posts[0]?.runNumber}`);
    if (page < MAX_PAGES) await sleep(FETCH_DELAY_MS);
  }
  return [...byRun.values()];
}

/** Walk the archive, drop the stray sub-series, and return the main DH3 runs. */
async function fetchEvents(): Promise<RawEventData[]> {
  console.log(`Walking ${ARCHIVE_BASE} (paged) …`);
  const parsed = await fetchArchive();
  const stray = parsed
    .filter((p) => p.runNumber < MAIN_SERIES_MIN)
    .sort((a, b) => a.runNumber - b.runNumber);
  if (stray.length > 0) {
    console.log(`\nExcluding ${stray.length} stray sub-series post(s) (runNumber < ${MAIN_SERIES_MIN}; COVID "Virtual DH3"):`);
    for (const s of stray) console.log(`  - Run ${s.runNumber} (${s.event.date}) ${s.event.location ?? ""}`);
  }
  return parsed.filter((p) => p.runNumber >= MAIN_SERIES_MIN).map((p) => p.event);
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Walking deserthash.org ?cat=3 archive",
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
