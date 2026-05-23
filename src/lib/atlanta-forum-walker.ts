/**
 * Shared phpBB forum walker used by the Atlanta Hash Board backfill scripts
 * (MLH4 #1590, Black Sheep #1573).
 *
 * The recurring `AtlantaHashBoardAdapter` reads the per-forum Atom feed at
 * `/app.php/feed/forum/{id}` which is a rolling 15-entry window. The deep
 * history (hundreds of past trails per kennel) lives on the paginated topic
 * listings at `/viewforum.php?f={id}&start={k*25}`. This walker hits those
 * pages, follows each non-reply topic to `/viewtopic.php`, isolates the
 * first-post body, and reuses the adapter's exported `extractEventDate` +
 * `extractEventFields` helpers so the backfill parser stays in lockstep with
 * the recurring scrape.
 *
 * The walker is intentionally pure-fetch + pure-parse — `processRawEvents`
 * in the merge pipeline does dedupe/fingerprint/upsert, and `runBackfillScript`
 * partitions to `date < today` so the recurring adapter still owns the
 * future window.
 */

import * as cheerio from "cheerio";
import { safeFetch } from "@/adapters/safe-fetch";
import { stripHtmlTags } from "@/adapters/utils";
import {
  extractEventDate,
  extractEventFields,
  isReplyEntry,
} from "@/adapters/html-scraper/atlanta-hash-board";
import type { RawEventData } from "@/adapters/types";

const BASE_URL = "https://board.atlantahash.com";
const TOPICS_PER_PAGE = 25; // phpBB 3.x default
const USER_AGENT = "Mozilla/5.0 (compatible; HashTracks-Backfill)";

export interface ForumWalkerConfig {
  /** phpBB forum ID (e.g. 8 for MLH4, 5 for Black Sheep). */
  forumId: number;
  /** kennelCode for the kennel that owns this forum (e.g. "mlh4"). */
  kennelTag: string;
  /** Regular hash day for date-inference fallback (e.g. "Monday"). */
  hashDay: string;
  /** Hard cap on pages walked — defensive, real forums sit comfortably under this. */
  maxPages?: number;
}

interface ForumTopic {
  topicId: string;
  title: string;
  url: string;
}

/**
 * Extract topic rows from one viewforum.php page.
 *
 * phpBB 3.x renders topics as `<a class="topictitle" href="./viewtopic.php?...">`,
 * sometimes nested in `<li class="row">`. We're generous on the selector and
 * normalize the href to an absolute URL anchored at BASE_URL.
 *
 * Exported for unit testing.
 */
export function parseForumIndexPage(html: string): ForumTopic[] {
  const $ = cheerio.load(html);
  const topics: ForumTopic[] = [];
  const seen = new Set<string>();

  $("a.topictitle").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") ?? "";
    const title = $el.text().trim();
    if (!href || !title) return;

    const topicIdMatch = /[?&]t=(\d+)/.exec(href);
    if (!topicIdMatch) return;
    const topicId = topicIdMatch[1];
    if (seen.has(topicId)) return; // sticky topics repeat across pages
    seen.add(topicId);

    // Normalize relative hrefs ("./viewtopic.php?..." or "viewtopic.php?...")
    // to absolute URLs against BASE_URL.
    const cleanHref = href.replace(/^\.\//, "");
    const url = cleanHref.startsWith("http")
      ? cleanHref
      : `${BASE_URL}/${cleanHref}`;

    topics.push({ topicId, title, url });
  });

  return topics;
}

/**
 * Isolate the first-post body HTML from a viewtopic.php page.
 *
 * phpBB 3.x puts each post in `<div class="post">` (or `.postbody`); within
 * that, the content lives in `<div class="content">`. The first such block
 * is the topic-opening post — replies follow.
 *
 * Exported for unit testing.
 */
export function extractFirstPostHtml(html: string): string | null {
  const $ = cheerio.load(html);
  const firstContent =
    $("div.post").first().find("div.content").first().html() ??
    $("div.postbody").first().find("div.content").first().html() ??
    $("div.content").first().html();
  return firstContent?.trim() || null;
}

/** Extract the first post's published-at ISO timestamp from a viewtopic page. */
export function extractFirstPostPublished(html: string): string | null {
  const $ = cheerio.load(html);
  // phpBB writes <time datetime="ISO-8601"> within the author block.
  const iso = $("div.post").first().find("time").first().attr("datetime")
    ?? $("div.postbody").first().find("time").first().attr("datetime")
    ?? $("time").first().attr("datetime");
  return iso ?? null;
}

/**
 * Extract the first post's phpBB post ID from `id="p<postId>"` on the post div.
 * Used to construct a `sourceUrl` matching the Atom-feed shape
 * (`viewtopic.php?p=<postId>#p<postId>`) so backfill RawEvents share the
 * fingerprint surface of the recurring scrape.
 *
 * Exported for unit testing.
 */
export function extractFirstPostId(html: string): string | null {
  const $ = cheerio.load(html);
  const id = $("div.post").first().attr("id")
    ?? $("div.postbody").first().closest("[id^=p]").attr("id");
  if (!id) return null;
  const match = /^p(\d+)$/.exec(id);
  return match ? match[1] : null;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await safeFetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return await res.text();
}

/** Walk every page of a forum index, collecting non-reply topic rows. */
async function walkForumIndex(
  forumId: number,
  maxPages: number,
): Promise<ForumTopic[]> {
  const all: ForumTopic[] = [];
  const seenIds = new Set<string>();
  for (let page = 0; page < maxPages; page++) {
    const start = page * TOPICS_PER_PAGE;
    const url = `${BASE_URL}/viewforum.php?f=${forumId}&start=${start}`;
    console.warn(`  index page ${page + 1} → ${url}`);
    const html = await fetchHtml(url);
    const topics = parseForumIndexPage(html).filter((t) => !isReplyEntry(t.title));

    // Loop guard: phpBB clamps `start` past the last page back to the last page,
    // so an unchanged page would re-yield already-seen topics. Stop when we
    // collect no new topic IDs.
    let newOnThisPage = 0;
    for (const t of topics) {
      if (seenIds.has(t.topicId)) continue;
      seenIds.add(t.topicId);
      all.push(t);
      newOnThisPage++;
    }
    console.warn(`    +${newOnThisPage} new topics (total: ${all.length})`);
    if (newOnThisPage === 0) break;
  }
  return all;
}

/**
 * Fetch + parse one topic into a RawEventData, or null if the topic body
 * yields no extractable event date.
 *
 * Throws when the page is missing the first-post `<time datetime>` — we
 * refuse to substitute "now" because date-inference from a fabricated
 * post-date would silently mis-bucket historical trails (Codex review).
 */
async function fetchTopicEvent(
  topic: ForumTopic,
  hashDay: string,
  kennelTag: string,
): Promise<RawEventData | null> {
  const html = await fetchHtml(topic.url);
  const bodyHtml = extractFirstPostHtml(html);
  if (!bodyHtml) return null;

  const published = extractFirstPostPublished(html);
  if (!published) {
    throw new Error(
      `topic t=${topic.topicId}: missing first-post <time datetime> — selector drift, refusing to fabricate reference date`,
    );
  }
  // Use `stripHtmlTags(..., "\n")` — same as the live adapter — so the
  // shared `extractEventFields` sees identical `\n`-delimited text. Plain
  // `cheerio.text()` flattens `<br>` boundaries and the label regexes
  // (Hares:, Where:, Time:) stop matching (Codex review).
  const bodyText = stripHtmlTags(bodyHtml, "\n");

  const date = extractEventDate(topic.title, bodyText, published, hashDay);
  if (!date) return null;

  const $body = cheerio.load(bodyHtml);
  const fields = extractEventFields(bodyHtml, bodyText, $body);

  // Title prefix: phpBB titles are typically "<kennel> • <trail name>" — strip
  // the kennel prefix so the canonical Event title is just the trail name. The
  // adapter's `extractTitleName` is not exported; replicate the bullet-split
  // shape here. `split("•").pop()` returns the whole string when no bullet is
  // present, so no guard is needed.
  const afterBullet = topic.title.replaceAll("·", "•").split("•").pop()!.trim();
  const titleClean = afterBullet.replace(/^Re:\s*/i, "").trim() || undefined;

  // Title-extracted run number takes precedence over body (#1587 ordering).
  const titleRunMatch = /#(\d{2,})/.exec(topic.title);
  const titleRunNumber = titleRunMatch
    ? Number.parseInt(titleRunMatch[1], 10)
    : undefined;

  // Match the live adapter's Atom-feed sourceUrl shape
  // (`viewtopic.php?p=<postId>#p<postId>`) so backfill rows fingerprint-dedupe
  // against feed rows for the recent-past overlap window (Codex review). When
  // post-id can't be extracted, fall back to the topic-level URL — slightly
  // worse dedupe but better than throwing.
  const postId = extractFirstPostId(html);
  const sourceUrl = postId
    ? `${BASE_URL}/viewtopic.php?p=${postId}#p${postId}`
    : topic.url;

  return {
    date,
    kennelTags: [kennelTag],
    runNumber: titleRunNumber ?? fields.runNumber,
    title: titleClean,
    // Emit raw `fields.hares` — the live adapter does the same, and any
    // walker-side normalization would split the fingerprint surface.
    hares: fields.hares,
    location: fields.location,
    locationUrl: fields.locationUrl,
    startTime: fields.startTime,
    sourceUrl,
    description: fields.description,
  };
}

/**
 * Main entry point: walk a single phpBB forum and return all parseable past
 * trail events. Caller (the backfill script) hands this to runBackfillScript
 * which partitions to `date < today` and merges via the live pipeline.
 */
export async function walkAtlantaForum(
  config: ForumWalkerConfig,
): Promise<RawEventData[]> {
  const { forumId, kennelTag, hashDay, maxPages = 30 } = config;
  console.warn(`Walking forum ${forumId} (${kennelTag}, ${hashDay})`);
  const topics = await walkForumIndex(forumId, maxPages);
  console.warn(`Collected ${topics.length} unique non-reply topics`);

  const events: RawEventData[] = [];
  let skipped = 0;
  for (let i = 0; i < topics.length; i++) {
    const t = topics[i];
    if (i % 10 === 0) console.warn(`  topic ${i + 1}/${topics.length}`);
    try {
      const event = await fetchTopicEvent(t, hashDay, kennelTag);
      if (event) events.push(event);
      else skipped++;
    } catch (err) {
      // Don't JSON.stringify the topic (PII in title/author): log only id + status.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  topic t=${t.topicId}: skipped (${msg})`);
      skipped++;
    }
  }
  console.warn(`Parsed ${events.length} events, skipped ${skipped} topics`);
  return events;
}
