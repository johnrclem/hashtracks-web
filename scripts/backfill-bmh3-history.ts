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
import { reportAndApplyBackfill } from "./lib/backfill-runner";
import { parseBrassMonkeyBody } from "@/adapters/html-scraper/brass-monkey";
import {
  chronoParseDate,
  decodeEntities,
  googleMapsSearchUrl,
  isPlaceholder,
  parse12HourTime,
  stripHtmlTags,
} from "@/adapters/utils";
import type { RawEventData } from "@/adapters/types";
import type { BloggerPost } from "@/adapters/blogger-api";

const SOURCE_NAME = "Brass Monkey H3 Blog";
const BLOG_URL = "https://teambrassmonkey.blogspot.com/";
const KENNEL_TIMEZONE = "America/Chicago";
const BLOGGER_API_BASE = "https://www.googleapis.com/blogger/v3";
const PAGE_SIZE = 100;
const FETCH_TIMEOUT_MS = 30_000;
const BLOG_ID_RE = /^\d+$/;

interface PostsPage {
  items?: BloggerPost[];
  nextPageToken?: string;
}

async function fetchWithTimeout(url: string, apiKey: string): Promise<Response> {
  return fetch(url, {
    headers: { "X-Goog-Api-Key": apiKey },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
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

    const res = await fetchWithTimeout(
      `${BLOGGER_API_BASE}/blogs/${blogId}/posts?${params.toString()}`,
      apiKey,
    );
    if (!res.ok) {
      throw new Error(`Blogger posts fetch failed (page ${page + 1}): HTTP ${res.status}`);
    }
    const data = (await res.json()) as PostsPage;
    const items = data.items ?? [];
    all.push(...items);
    page++;
    console.log(`  Page ${page}: +${items.length} posts (total: ${all.length})`);
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
  const res = await fetchWithTimeout(
    `${BLOGGER_API_BASE}/blogs/byurl?${params.toString()}`,
    apiKey,
  );
  if (!res.ok) throw new Error(`Blogger byurl failed: HTTP ${res.status}`);
  const data = (await res.json()) as { id?: string };
  // Validate to neutralize SSRF: the ID is interpolated into a URL path on
  // subsequent calls, so reject anything that isn't a numeric Blogger ID.
  if (!data.id || !BLOG_ID_RE.test(data.id)) {
    throw new Error("Blogger byurl returned an invalid blog ID");
  }
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
  const runNumber = Number.parseInt(runMatch[1], 10);

  // Everything after the "#NNN" token — that's the trail name / date.
  const tailStart = runMatch.index + runMatch[0].length;
  const tail = title.slice(tailStart);

  // Extract numeric date if present (new-style posts embed it).
  const dateMatch = NUMERIC_DATE_IN_TITLE_RE.exec(tail);
  const date = dateMatch ? chronoParseDate(dateMatch[1], "en-US") : undefined;

  let cleaned = tail;
  if (dateMatch && date) cleaned = cleaned.replaceAll(dateMatch[0], "");
  // Strip leading/trailing separators (colons, dashes, em/en dashes, whitespace)
  // — two anchored passes, no alternation, to avoid super-linear backtracking.
  cleaned = cleaned.replaceAll(/^[\s:–—-]+/g, "").replaceAll(/[\s:–—-]+$/g, "").trim();

  return {
    runNumber,
    title: cleaned || undefined,
    date: date ?? undefined,
  };
}

// Old-format body fields (2010–2016 posts). Labels typically appear on their
// own lines with the value either on the same line or the following line:
//   "When : Saturday, August 16th, at 4:00pm!"
//   "Where : Backwoods Saloon 230 Lexington Conroe, TX 77385"
//   "Hares : Mighty Mighty Small Mouth & EZ Chair"
// Year is often omitted — resolved via chrono with publish-date as reference.
const LABEL_LINE_RE = /^\s*([A-Za-z]+)\s*:\s?(.*)$/;

/**
 * Find a labelled value in a body split into lines. The value may share the
 * label's line, or span the next non-empty line(s) until the next label.
 * Linear scan, no super-linear regex backtracking.
 */
function findLabelValue(bodyLines: string[], label: RegExp): string | undefined {
  for (let i = 0; i < bodyLines.length; i++) {
    const m = LABEL_LINE_RE.exec(bodyLines[i]);
    if (!m || !label.test(m[1])) continue;
    const inline = m[2].trim();
    if (inline) return inline;
    for (let j = i + 1; j < bodyLines.length; j++) {
      const next = bodyLines[j].trim();
      if (!next) continue;
      if (LABEL_LINE_RE.test(bodyLines[j])) return undefined;
      return next;
    }
    return undefined;
  }
  return undefined;
}

const WHEN_LABEL = /^when$/i;
const WHERE_LABEL = /^where$/i;

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
  // Bound `\s*` to avoid super-linear backtracking on pathological whitespace.
  const stripped = whenText.replaceAll(/,?\s{0,4}\b(?:19|20)\d{2}\b/g, "").trim();
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

  const lines = bodyText.split("\n");
  const whenText = findLabelValue(lines, WHEN_LABEL) ?? "";
  const publishDate = new Date(publishedIso);
  const date = strict.date ?? (whenText ? parseFallbackDate(whenText, publishDate) : undefined);

  const location = strict.location ?? findLabelValue(lines, WHERE_LABEL);

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

  console.log("\n[3/3] Reporting + applying...");
  await reportAndApplyBackfill({
    apply,
    sourceName: SOURCE_NAME,
    events: parsed,
    kennelTimezone: KENNEL_TIMEZONE,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
