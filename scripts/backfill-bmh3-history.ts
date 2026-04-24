/**
 * One-shot historical backfill for Brass Monkey H3 (BMH3, Houston).
 *
 * The live BrassMonkeyAdapter uses the Blogger API but honors
 * source.scrapeDays (default 180), so runs older than ~6 months are dropped
 * before they reach RawEvents. The blog has ~453 posts going back to the
 * kennel's founding in Feb 2010 — this script paginates through the full
 * archive, parses each trail post via the adapter's exported helpers, and
 * inserts past-dated RawEvents.
 *
 * Partition: live adapter owns `date >= CURDATE()` (via scrapeDays window),
 * this script owns `date < CURDATE()`. `insertRawEventsForSource`
 * fingerprint-dedupes, so the script is safely re-runnable.
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-bmh3-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-bmh3-history.ts
 *   Env:       GOOGLE_CALENDAR_API_KEY (required, same as live adapter)
 */

import "dotenv/config";
import { insertRawEventsForSource } from "./lib/backfill-runner";
import { parseBrassMonkeyBody } from "@/adapters/html-scraper/brass-monkey";
import {
  chronoParseDate,
  decodeEntities,
  googleMapsSearchUrl,
  isPlaceholder,
  parse12HourTime,
  stripHtmlTags,
} from "@/adapters/utils";
import { todayInTimezone } from "@/lib/timezone";
import type { RawEventData } from "@/adapters/types";
import type { BloggerPost } from "@/adapters/blogger-api";

const SOURCE_NAME = "Brass Monkey H3 Blog";
const BLOG_URL = "https://teambrassmonkey.blogspot.com/";
const KENNEL_TIMEZONE = "America/Chicago";
const BLOGGER_API_BASE = "https://www.googleapis.com/blogger/v3";
const PAGE_SIZE = 100;

interface PostsPage {
  items?: BloggerPost[];
  nextPageToken?: string;
}

async function fetchAllPosts(blogId: string, apiKey: string): Promise<BloggerPost[]> {
  const all: BloggerPost[] = [];
  let pageToken: string | undefined;
  let page = 0;
  const seenTokens = new Set<string>();

  do {
    const params = new URLSearchParams({
      maxResults: String(PAGE_SIZE),
      fetchBodies: "true",
      fields: "nextPageToken,items(title,content,url,published)",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`${BLOGGER_API_BASE}/blogs/${blogId}/posts?${params.toString()}`, {
      headers: { "X-Goog-Api-Key": apiKey },
    });
    if (!res.ok) {
      throw new Error(`Blogger posts fetch failed (page ${page + 1}): HTTP ${res.status}`);
    }
    const data = (await res.json()) as PostsPage;
    const items = data.items ?? [];
    all.push(...items);
    page++;
    console.log(`  Page ${page}: +${items.length} posts (running total: ${all.length})`);
    const nextToken = data.nextPageToken;
    if (nextToken && seenTokens.has(nextToken)) {
      throw new Error(`Blogger pagination returned a repeated pageToken at page ${page}`);
    }
    if (nextToken) seenTokens.add(nextToken);
    pageToken = nextToken;
  } while (pageToken);

  return all;
}

async function discoverBlogId(apiKey: string): Promise<string> {
  const params = new URLSearchParams({ url: BLOG_URL });
  const res = await fetch(`${BLOGGER_API_BASE}/blogs/byurl?${params.toString()}`, {
    headers: { "X-Goog-Api-Key": apiKey },
  });
  if (!res.ok) throw new Error(`Blogger byurl failed: HTTP ${res.status}`);
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("Blogger byurl returned no blog ID");
  return data.id;
}

// Broader than the live adapter regex: tolerates "BRASS MONKEY H3 RUN # 118"
// and "BMH3 R*N # 181" formats used in 2010–2019. Requires a BMH3/Brass Monkey
// marker AND a #NNN token within 80 chars to avoid false positives from
// non-trail posts (e.g. "we need hares in May and beyond").
const TRAIL_TITLE_RE = /(?:\bbrass\s+monkey\b|\bbmh3\b)[^#]{0,80}#\s*(\d+)\b/i;
const NUMERIC_DATE_IN_TITLE_RE = /(\d{1,2}\/\d{1,2}\/\d{2,4})/;
// Meta-posts that reference a run # but aren't the trail announcement itself
// (e.g. travel itinerary for the kennel's founding run). Kept narrow — words
// like "photos"/"recap"/"video" can appear inside legitimate trail titles, so
// we only match tokens that specifically indicate a supplementary post.
const META_POST_TITLE_RE = /^(?:itinerary\b|.*\bitinerary\s+for\b)/i;

function parseBackfillTitle(rawTitle: string): {
  runNumber?: number;
  title?: string;
  date?: string;
} {
  const title = rawTitle.trim();
  if (META_POST_TITLE_RE.test(title)) return {};
  const runMatch = TRAIL_TITLE_RE.exec(title);
  if (!runMatch) return {};
  const runNumber = parseInt(runMatch[1], 10);

  // Everything after the "#NNN" token — that's the trail name / date.
  const tailStart = runMatch.index + runMatch[0].length;
  const tail = title.slice(tailStart);

  // Extract numeric date if present (new-style posts embed it).
  const dateMatch = NUMERIC_DATE_IN_TITLE_RE.exec(tail);
  const date = dateMatch ? chronoParseDate(dateMatch[1], "en-US") : undefined;

  let cleaned = tail;
  if (dateMatch && date) cleaned = cleaned.replace(dateMatch[0], "");
  cleaned = cleaned.replace(/^[\s:–—-]+|[\s:–—-]+$/g, "").trim();

  return {
    runNumber,
    title: cleaned || undefined,
    date: date ?? undefined,
  };
}

// Old-format body fields (2010–2016 posts). Labels are space-separated:
//   "When : Saturday, August 16th, at 4:00pm!"
//   "Where : Backwoods Saloon 230 Lexington Conroe, TX 77385"
//   "Hares : Mighty Mighty Small Mouth & EZ Chair"
// Year is often omitted — resolved via chrono with publish-date as reference.
const WHEN_LABEL_RE = /When\s*:\s*(.+?)(?=\n|Where\s*:|Hares?\s*:|$)/i;
const WHERE_LABEL_RE = /Where\s*:\s*(.+?)(?=\n|Hares?\s*:|Why\s*:|Bring\s*:|$)/i;

// Trail dates should fall within ~6 months of publish (typical lead time is a
// few weeks, but occasional anniversary/roadtrip announcements post earlier).
// Dates further than this are almost certainly typo years in stale boilerplate.
const PLAUSIBLE_MIN_DAYS = -30;
const PLAUSIBLE_MAX_DAYS = 180;

function withinPlausibleWindow(parsedDate: string, publishDate: Date): boolean {
  const publishMs = publishDate.getTime();
  const parsedMs = new Date(`${parsedDate}T12:00:00Z`).getTime();
  const diffDays = (parsedMs - publishMs) / 86_400_000;
  return diffDays >= PLAUSIBLE_MIN_DAYS && diffDays <= PLAUSIBLE_MAX_DAYS;
}

/**
 * Parse a date string that may contain a stale boilerplate year.
 *
 * Old BMH3 posts sometimes left a stale year in place (e.g. "Saturday January
 * 8th, 2010" on a run published 2011-01-05 for a Jan 8 2011 trail). First
 * trust any explicit year; if the resulting date falls outside the plausible
 * publish-to-trail window, re-parse with the year stripped so chrono infers
 * from the publish date. Returns undefined if neither parse is plausible.
 */
function parseFallbackDate(whenText: string, publishDate: Date): string | undefined {
  const parsed = chronoParseDate(whenText, "en-US", publishDate);
  if (parsed && withinPlausibleWindow(parsed, publishDate)) return parsed;
  const stripped = whenText.replace(/,?\s*\b(19|20)\d{2}\b/g, "").trim();
  if (!stripped) return undefined;
  const reparsed = chronoParseDate(stripped, "en-US", publishDate);
  if (reparsed && withinPlausibleWindow(reparsed, publishDate)) return reparsed;
  return undefined;
}

function parseBackfillBody(
  bodyText: string,
  publishedIso: string,
): { date?: string; startTime?: string; location?: string; hares?: string } {
  const strict = parseBrassMonkeyBody(bodyText);
  if (strict.date && strict.location && strict.hares) return strict;

  const whenMatch = WHEN_LABEL_RE.exec(bodyText);
  const whenText = whenMatch ? whenMatch[1].trim() : "";
  const publishDate = new Date(publishedIso);
  const date = strict.date ?? (whenText ? parseFallbackDate(whenText, publishDate) : undefined);

  const whereMatch = WHERE_LABEL_RE.exec(bodyText);
  const location = strict.location ?? (whereMatch ? whereMatch[1].trim() : undefined);

  const startTime = strict.startTime ?? (whenText ? parse12HourTime(whenText) : undefined);

  return { date, startTime, location, hares: strict.hares };
}

type SkipReason = "no-run-number" | "no-date";

function postToRawEvent(post: BloggerPost): RawEventData | SkipReason {
  const titleFields = parseBackfillTitle(decodeEntities(post.title));
  if (titleFields.runNumber == null) return "no-run-number";

  const bodyText = stripHtmlTags(post.content, "\n");
  const bodyFields = parseBackfillBody(bodyText, post.published);

  // Title MM/DD/YYYY is explicit and authoritative; body dates can be freeform
  // prose with stale boilerplate years.
  const date = titleFields.date ?? bodyFields.date;
  if (!date) return "no-date";

  const location = bodyFields.location && !isPlaceholder(bodyFields.location)
    ? bodyFields.location
    : undefined;

  return {
    date,
    kennelTag: "bmh3-tx",
    runNumber: titleFields.runNumber,
    title: titleFields.title,
    hares: bodyFields.hares,
    location,
    locationUrl: location ? googleMapsSearchUrl(location) : undefined,
    startTime: bodyFields.startTime,
    sourceUrl: post.url,
  };
}

async function main() {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);

  const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_CALENDAR_API_KEY");

  console.log("\n[1/3] Discovering blog ID + fetching all posts...");
  const blogId = await discoverBlogId(apiKey);
  console.log(`  Blog ID: ${blogId}`);
  const posts = await fetchAllPosts(blogId, apiKey);
  console.log(`  Fetched ${posts.length} total posts`);

  console.log("\n[2/3] Parsing posts into RawEvents...");
  const parsed: RawEventData[] = [];
  let skippedNoRun = 0;
  let skippedNoDate = 0;
  for (const post of posts) {
    const result = postToRawEvent(post);
    if (result === "no-run-number") skippedNoRun++;
    else if (result === "no-date") skippedNoDate++;
    else parsed.push(result);
  }
  console.log(`  Parsed: ${parsed.length}. Skipped: ${skippedNoRun} no-run-number, ${skippedNoDate} no-date.`);

  const today = todayInTimezone(KENNEL_TIMEZONE);
  const past = parsed.filter((e) => e.date < today);
  const futureOrToday = parsed.length - past.length;
  console.log(`  Partition: ${past.length} past rows, ${futureOrToday} skipped (date >= ${today})`);

  const sorted = [...past].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length > 0) {
    console.log(`\nDate range: ${sorted[0].date} → ${sorted[sorted.length - 1].date}`);
    const sampleIdx = [0, Math.floor(sorted.length / 2), sorted.length - 1];
    console.log("Samples (oldest, middle, newest):");
    for (const i of sampleIdx) {
      const e = sorted[i];
      console.log(
        `  #${e.runNumber ?? "?"} ${e.date} | title=${e.title ?? "—"} | hares=${e.hares ?? "—"} | loc=${e.location ?? "—"} | start=${e.startTime ?? "—"}`,
      );
    }
  }

  if (!apply) {
    console.log("\n[3/3] Dry run complete. Re-run with BACKFILL_APPLY=1 to write to DB.");
    return;
  }
  if (past.length === 0) {
    console.log("\nNo events to insert. Exiting.");
    return;
  }

  console.log("\n[3/3] Writing to DB...");
  const { preExisting, inserted } = await insertRawEventsForSource(SOURCE_NAME, past);
  console.log(`  Pre-existing: ${preExisting}. Inserted: ${inserted}.`);
  if (inserted > 0) {
    console.log(`\nDone. Trigger a scrape of "${SOURCE_NAME}" from the admin UI to merge the new RawEvents.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
