/**
 * AH4 (Atlanta H4, the original Saturday Atlanta kennel) historical backfill
 * from the Internet Archive — issue #638.
 *
 * Context: the recurring `Atlanta Hash Board` HTML scraper read the phpBB forum
 * at board.atlantahash.com (forum f=2 = "Atlanta Hash (Saturdays)" = AH4). That
 * site went dark around 2025-10-16 (issue #633) — board.atlantahash.com AND
 * atlantahash.com both time out, the Meetup group is dead, and HashRego carries
 * only a profile + one 2026 weekend event. No live recurring source exists, so
 * the only public trace of AH4's past trails is the Internet Archive, which
 * individually crawled a subset of the board's `viewtopic.php` pages.
 *
 * This script harvests those archived topic pages:
 *   1. Query the Wayback CDX API for every `board.atlantahash.com/viewtopic.php`
 *      snapshot (HTTP 200 only). phpBB topic IDs are GLOBAL across all 9 forums,
 *      so the CDX list mixes AH4 with Pinelake / Moonlite / etc.
 *   2. Collapse to one capture per distinct topic id (`?t=<N>`), newest first.
 *   3. Fetch each via the `…/web/<ts>id_/<url>` RAW form (`id_` returns the
 *      UNREWRITTEN original HTML so the phpBB template parses cleanly).
 *   4. Keep ONLY topics whose breadcrumb deepest forum is f=2 (AH4) — read from
 *      the `<a itemprop="item" href="…viewforum.php?f=N">` microdata trail, NOT
 *      the jumpbox dropdown (which lists every forum). This is how a Pinelake
 *      topic (f=4) that happens to share the global id space is excluded.
 *   5. Parse the first post with the SAME exported helpers the recurring adapter
 *      + live forum-walker use (`extractEventDate` / `extractEventFields` /
 *      `extractFirstPost*`), so backfill rows fingerprint-dedupe against any
 *      future recurring scrape and the parser stays in lockstep. The event date
 *      comes from the post body (NEVER the CDX crawl timestamp); rows with no
 *      parseable date are skipped, never guessed.
 *
 * Yield: bounded by what the Archive crawled — far fewer than the ~94 live
 * topics the board showed in Oct 2025 (Wayback snapshotted only page 1 of the
 * index, twice, and a scattering of individual topics). This recovers whatever
 * AH4 topic pages were archived; the remainder is gone with the site. Issue
 * #633 (no live source) is documented separately and stays a follow-up.
 *
 * Bound to "Atlanta Hash Board" (the trust-7 HTML scraper the f=2 forum fed);
 * `ah4` is already SourceKennel-linked, so the merge pipeline's source-kennel
 * guard passes. `runBackfillScript` partitions to `date < today(America/
 * New_York)` so a future live source (should the board return) still owns the
 * forward window.
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-ah4-wayback-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-ah4-wayback-history.ts
 *   Env:       DATABASE_URL
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import type { RawEventData } from "@/adapters/types";
import { safeFetch } from "@/adapters/safe-fetch";
import { chronoParseDate, stripHtmlTags } from "@/adapters/utils";
import {
  extractEventDate,
  extractEventFields,
  isReplyEntry,
} from "@/adapters/html-scraper/atlanta-hash-board";
import {
  extractFirstPostHtml,
  extractFirstPostId,
  extractFirstPostPublished,
} from "@/lib/atlanta-forum-walker";
import { runBackfillScript } from "./lib/backfill-runner";

const SOURCE_NAME = "Atlanta Hash Board";
const KENNEL_TAG = "ah4";
const KENNEL_TIMEZONE = "America/New_York";
const KENNEL_HASH_DAY = "Saturday";
const ORIGIN = "https://board.atlantahash.com";
/** phpBB forum id for "Atlanta Hash (Saturdays)" = AH4. */
const AH4_FORUM_ID = 2;

// Every 200 capture of every viewtopic page. No `collapse` here — we collapse
// per-topic in parseViewtopicCdx (keeping the newest capture) ourselves.
const CDX_URL =
  "https://web.archive.org/cdx/search/cdx?url=board.atlantahash.com/viewtopic.php" +
  "&matchType=prefix&output=text&fl=original,timestamp&filter=statuscode:200";

const BATCH_SIZE = 3;
const POLITENESS_DELAY_MS = 600;
const USER_AGENT = "Mozilla/5.0 (compatible; HashTracks-Backfill)";

/** Resolve after `ms` milliseconds (politeness delay between Wayback hits). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** GET `url` via the SSRF-validated client, retrying 5xx/network errors with
 *  backoff. Returns the body text, or null after `attempts` failures / on 4xx. */
async function fetchText(url: string, attempts = 3): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      // safeFetch (not bare fetch) applies the repo's SSRF URL validation — the
      // Wayback URLs are built from CDX response data, so route them through the
      // sanctioned client (matches backfill-lbh-phx-history-completion.ts).
      const res = await safeFetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(45_000),
      });
      if (res.ok) return await res.text();
      // 4xx won't improve on retry; bail. 5xx (Wayback overload) → retry.
      if (res.status < 500) return null;
    } catch {
      // network/timeout — fall through to retry
    }
    if (i < attempts - 1) await sleep(POLITENESS_DELAY_MS * (i + 1));
  }
  return null;
}

export interface TopicSnapshot {
  topicId: string;
  /** Newest archived 200-capture timestamp (YYYYMMDDhhmmss). */
  timestamp: string;
  /** Original board.atlantahash.com URL (used to build the `id_` raw URL). */
  original: string;
}

/**
 * Parse CDX text rows into one snapshot per distinct topic id (`?t=<N>`),
 * carrying the NEWEST 200-capture. Rows without a `t=` parameter (bare `?p=`
 * post permalinks, search links, etc.) are dropped — those don't map cleanly to
 * a topic page and the `t=` captures already cover the topic openers. 14-digit
 * Wayback timestamps sort lexicographically == chronologically, so a string
 * compare picks the newest capture. Exported for unit testing.
 */
export function parseViewtopicCdx(cdxText: string): TopicSnapshot[] {
  const byTopic = new Map<string, TopicSnapshot>();
  for (const line of cdxText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [original, timestamp] = trimmed.split(/\s+/);
    if (!original || !timestamp) continue;
    const topicMatch = /[?&]t=(\d+)/.exec(original);
    if (!topicMatch) continue;
    const topicId = topicMatch[1];
    const existing = byTopic.get(topicId);
    if (!existing || timestamp > existing.timestamp) {
      byTopic.set(topicId, { topicId, timestamp, original });
    }
  }
  // Stable ascending-by-id order so a re-run harvests in the same sequence.
  return [...byTopic.values()].sort(
    (a, b) => Number.parseInt(a.topicId, 10) - Number.parseInt(b.topicId, 10),
  );
}

/** Build the Wayback `id_` RAW (unrewritten) URL for a capture. */
export function waybackRawUrl(timestamp: string, original: string): string {
  return `https://web.archive.org/web/${timestamp}id_/${original}`;
}

/**
 * The topic's owning forum id, read from the deepest `<a itemprop="item">`
 * breadcrumb link (phpBB renders `Board index ‹ Atlanta Area Hashes (f=1) ‹
 * <Forum> (f=N)` as a microdata trail). The LAST such link is the topic's
 * forum. The jumpbox dropdown also links every forum but uses
 * `class="jumpbox-*"` and no `itemprop`, so it's excluded. Returns null when no
 * breadcrumb forum link is present. Exported for unit testing.
 */
export function extractTopicForumId(htmlOr$: string | cheerio.CheerioAPI): number | null {
  const $ = typeof htmlOr$ === "string" ? cheerio.load(htmlOr$) : htmlOr$;
  let forumId: number | null = null;
  $('a[itemprop="item"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const m = /[?&]f=(\d+)/.exec(href);
    if (m) forumId = Number.parseInt(m[1], 10);
  });
  return forumId;
}

/** The topic title from the phpBB `<h2 class="topic-title">` heading. Accepts a
 *  raw HTML string or an already-loaded Cheerio instance to avoid re-parsing. */
export function extractTopicTitle(htmlOr$: string | cheerio.CheerioAPI): string | null {
  const $ = typeof htmlOr$ === "string" ? cheerio.load(htmlOr$) : htmlOr$;
  const title =
    $("h2.topic-title a").first().text().trim() ||
    $("h2.topic-title").first().text().trim();
  return title || null;
}

/**
 * True when the post carries an EXPLICIT event date that the shared
 * `extractEventDate` would read from the body or title — i.e. NOT its
 * hash-day inference fallback. This guard exists because the live recurring
 * adapter deliberately infers "next Saturday after the post timestamp" for
 * upcoming runs, but for a one-shot HISTORICAL import that inference would
 * silently fabricate a date from the (crawl-time) post timestamp. We mirror
 * `extractEventDate` steps 1-2 exactly — running the same `chronoParseDate`
 * checks — so a date is accepted only when the same explicit branch the helper
 * uses actually fires. Topics with only the inference fallback are skipped,
 * never guessed.
 */
export function hasExplicitEventDate(title: string, body: string, refDate: Date): boolean {
  // Step 1 — body "When/Date/Day:" line or a slash date, accepted only if
  // chrono parses the captured value (matches extractEventDate's body loop).
  const bodyPatterns = [
    /(?:When|Date|Day)\s*:\s*([^\n<]*)(?:\n|<br|$)/i,
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
  ];
  for (const pattern of bodyPatterns) {
    const match = pattern.exec(body);
    if (match && chronoParseDate(match[1], "en-US", refDate, { forwardDate: true })) {
      return true;
    }
  }
  // Step 2 — title date, after the same prefix/run-number stripping.
  const normalized = title.replaceAll("·", "•");
  const afterBullet = normalized.includes("•")
    ? normalized.split("•").pop()!.trim()
    : title;
  const titleClean = afterBullet.replaceAll(/#\d+/g, "").trim();
  return chronoParseDate(titleClean, "en-US", refDate, { forwardDate: true }) !== null;
}

/**
 * Turn one archived AH4 topic page into a RawEventData, or null when it isn't
 * AH4, isn't a real topic, or has no EXPLICIT event date. The field-extraction
 * path mirrors the live forum-walker's `fetchTopicEvent` so backfill rows share
 * the recurring scrape's fingerprint surface. `preloaded$` lets `harvestTopic`
 * reuse the page it already parsed for the forum check instead of re-loading.
 */
export function buildAh4Event(
  html: string,
  preloaded$?: cheerio.CheerioAPI,
): RawEventData | null {
  const $ = preloaded$ ?? cheerio.load(html);
  if (extractTopicForumId($) !== AH4_FORUM_ID) return null;

  const title = extractTopicTitle($);
  if (!title || isReplyEntry(title)) return null;

  const bodyHtml = extractFirstPostHtml(html);
  if (!bodyHtml) return null;

  const published = extractFirstPostPublished(html);
  if (!published) return null; // refuse to fabricate a reference date

  // `stripHtmlTags(..., "\n")` — same as the live adapter — so the shared
  // `extractEventFields` sees identical `\n`-delimited text and its label
  // regexes (Hares:, Where:, Time:) keep matching.
  const bodyText = stripHtmlTags(bodyHtml, "\n");

  // Refuse the hash-day inference fallback: a historical import must skip a
  // post that lacks an explicit date rather than back-date it to the Saturday
  // after the crawl-time post timestamp (Codex adversarial review).
  const refDate = new Date(published);
  if (Number.isNaN(refDate.getTime())) return null;
  if (!hasExplicitEventDate(title, bodyText, refDate)) return null;

  const date = extractEventDate(title, bodyText, published, KENNEL_HASH_DAY);
  if (!date) return null;

  const $body = cheerio.load(bodyHtml);
  const fields = extractEventFields(bodyHtml, bodyText, $body);

  // Title-extracted run number takes precedence over body (matches the walker's
  // #1587 ordering). Two-plus digits to avoid matching stray "#1" decorations.
  const titleRunMatch = /#(\d{2,})/.exec(title);
  const titleRunNumber = titleRunMatch
    ? Number.parseInt(titleRunMatch[1], 10)
    : undefined;

  // Match the live adapter's Atom-feed sourceUrl shape so backfill rows
  // fingerprint-dedupe against feed rows for any recent-past overlap window.
  const postId = extractFirstPostId(html);
  const sourceUrl = postId
    ? `${ORIGIN}/viewtopic.php?p=${postId}#p${postId}`
    : undefined;

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber: titleRunNumber ?? fields.runNumber,
    title,
    hares: fields.hares,
    location: fields.location,
    locationUrl: fields.locationUrl,
    startTime: fields.startTime,
    description: fields.description,
    sourceUrl,
  };
}

interface HarvestResult {
  /** True when the topic's breadcrumb forum is AH4 (f=2). */
  isAh4: boolean;
  /** Parsed event, present only when the AH4 post had a parseable date. */
  event: RawEventData | null;
}

/** Fetch one archived topic and parse it. Parses the HTML ONCE and reuses that
 *  Cheerio instance for the forum check + `buildAh4Event` (no redundant loads). */
async function harvestTopic(snap: TopicSnapshot): Promise<HarvestResult> {
  const html = await fetchText(waybackRawUrl(snap.timestamp, snap.original));
  if (!html) return { isAh4: false, event: null };
  const $ = cheerio.load(html);
  if (extractTopicForumId($) !== AH4_FORUM_ID) return { isAh4: false, event: null };
  return { isAh4: true, event: buildAh4Event(html, $) };
}

interface HarvestSummary {
  events: RawEventData[];
  /** Count of topics whose breadcrumb forum was AH4 (with or without a date). */
  ah4Topics: number;
}

/** Fetch + parse every snapshot in politeness-delayed batches. */
async function harvestAllTopics(snapshots: TopicSnapshot[]): Promise<HarvestSummary> {
  const events: RawEventData[] = [];
  let ah4Topics = 0;
  for (let i = 0; i < snapshots.length; i += BATCH_SIZE) {
    const batch = snapshots.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(harvestTopic));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "rejected") {
        // Surface transient fetch/parse crashes in the warning stream rather
        // than silently undercounting (Gemini review).
        console.warn(`  topic t=${batch[j].topicId}: harvest failed —`, r.reason);
        continue;
      }
      if (r.value.isAh4) ah4Topics++;
      if (r.value.event) events.push(r.value.event);
    }
    await sleep(POLITENESS_DELAY_MS);
  }
  return { events, ah4Topics };
}

/** BACKFILL_DUMP=1 prints every harvested row (date | #run | sourceUrl) — used
 *  to diff a guarded run against what a prior run already wrote to prod. */
function dumpEvents(events: RawEventData[]): void {
  if (process.env.BACKFILL_DUMP !== "1") return;
  for (const e of [...events].sort((a, b) => a.date.localeCompare(b.date))) {
    console.log(`  DUMP ${e.date} | #${e.runNumber ?? "?"} | ${e.sourceUrl ?? "—"}`);
  }
}

/** Entry point handed to `runBackfillScript`: query CDX, harvest every AH4
 *  topic, and return the explicit-date events for the merge pipeline. */
async function fetchEvents(): Promise<RawEventData[]> {
  console.log("  Querying Wayback CDX for archived board.atlantahash.com topics...");
  const cdx = await fetchText(CDX_URL);
  if (!cdx) {
    throw new Error("Wayback CDX query failed (no response after retries).");
  }
  const snapshots = parseViewtopicCdx(cdx);
  console.log(
    `  ${snapshots.length} distinct archived topic(s) across all forums — ` +
      `filtering to AH4 (f=${AH4_FORUM_ID})...`,
  );

  const { events, ah4Topics } = await harvestAllTopics(snapshots);
  console.log(
    `  ${ah4Topics} archived AH4 topic(s); recovered ${events.length} with an explicit body/title date ` +
      `(${ah4Topics - events.length} skipped — no explicit date / reply / no first post).`,
  );
  dumpEvents(events);
  return events;
}

if (process.argv[1]?.endsWith("backfill-ah4-wayback-history.ts")) {
  runBackfillScript({
    sourceName: SOURCE_NAME,
    kennelTimezone: KENNEL_TIMEZONE,
    label: "Harvesting Wayback-archived AH4 forum topics (board.atlantahash.com is down)",
    fetchEvents,
  }).catch((err: unknown) => {
    console.error("FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
