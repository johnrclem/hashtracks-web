/**
 * Shared Wayback-Machine historical harvester for the Atlanta Hash Board phpBB
 * forums (board.atlantahash.com). The board sits behind OVH's anti-DDoS firewall
 * (blocks datacenter + residential; only the prod VPN egress reaches it), and its
 * Atom feed is a ~15-topic rolling window — so past topics are only recoverable
 * from the Internet Archive, which crawled a subset of the board's
 * `viewtopic.php` pages.
 *
 * phpBB topic IDs are GLOBAL across all forums, so one CDX list mixes every
 * kennel; each caller filters to its own forum id via the breadcrumb microdata.
 * Parsing reuses the SAME exported helpers as the live adapter
 * (`extractEventDate` / `extractEventFields` / `extractRunNumberFromTitle`) plus
 * the live forum-walker's `extractFirstPost*`, so backfill rows fingerprint-
 * dedupe against any live scrape and the parser stays in lockstep — including the
 * run-number fix (`# NNN` / single-digit) shipped in the same cluster.
 *
 * Modeled on scripts/backfill-ah4-wayback-history.ts (issue #638). Kept generic
 * so the SLUT (f=10) and Pinelake (f=4) backfills are one-line entry points.
 */
import * as cheerio from "cheerio";
import type { RawEventData } from "@/adapters/types";
import { safeFetch } from "@/adapters/safe-fetch";
import { chronoParseDate, stripHtmlTags } from "@/adapters/utils";
import {
  extractEventDate,
  extractEventFields,
  extractRunNumberFromTitle,
  isReplyEntry,
} from "@/adapters/html-scraper/atlanta-hash-board";
import {
  extractFirstPostHtml,
  extractFirstPostId,
  extractFirstPostPublished,
} from "@/lib/atlanta-forum-walker";
import { runBackfillScript } from "./backfill-runner";

export const SOURCE_NAME = "Atlanta Hash Board";
export const KENNEL_TIMEZONE = "America/New_York";
const ORIGIN = "https://board.atlantahash.com";

const CDX_URL =
  "https://web.archive.org/cdx/search/cdx?url=board.atlantahash.com/viewtopic.php" +
  "&matchType=prefix&output=text&fl=original,timestamp&filter=statuscode:200";

const BATCH_SIZE = 3;
const POLITENESS_DELAY_MS = 600;
const USER_AGENT = "Mozilla/5.0 (compatible; HashTracks-Backfill)";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** GET `url` via the SSRF-validated client, retrying 5xx/network with backoff. */
async function fetchText(url: string, attempts = 3): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await safeFetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(45_000),
      });
      if (res.ok) return await res.text();
      if (res.status < 500) return null; // 4xx won't improve on retry
    } catch {
      // network/timeout — fall through to retry
    }
    if (i < attempts - 1) await sleep(POLITENESS_DELAY_MS * (i + 1));
  }
  return null;
}

export interface TopicSnapshot {
  topicId: string;
  timestamp: string; // newest 200-capture, YYYYMMDDhhmmss
  original: string;
}

/**
 * Parse CDX text into one snapshot per distinct topic id (`?t=<N>`), newest
 * capture wins (14-digit timestamps sort lexicographically == chronologically).
 * Bare `?p=` permalinks / search links are dropped. Exported for unit testing.
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
  return [...byTopic.values()].sort(
    (a, b) => Number.parseInt(a.topicId, 10) - Number.parseInt(b.topicId, 10),
  );
}

/** Build the Wayback `id_` RAW (unrewritten) URL for a capture. */
export function waybackRawUrl(timestamp: string, original: string): string {
  return `https://web.archive.org/web/${timestamp}id_/${original}`;
}

/**
 * The topic's owning forum id, from the deepest `<a itemprop="item">` breadcrumb
 * link (phpBB microdata trail). The jumpbox dropdown lists every forum but uses
 * `class="jumpbox-*"` and no `itemprop`, so it's excluded. Exported for testing.
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

/** The topic title from the phpBB `<h2 class="topic-title">` heading. */
export function extractTopicTitle(htmlOr$: string | cheerio.CheerioAPI): string | null {
  const $ = typeof htmlOr$ === "string" ? cheerio.load(htmlOr$) : htmlOr$;
  const title =
    $("h2.topic-title a").first().text().trim() ||
    $("h2.topic-title").first().text().trim();
  return title || null;
}

/**
 * True when the post carries an EXPLICIT event date `extractEventDate` would read
 * from body/title — NOT its hash-day inference fallback (which for a historical
 * import would fabricate a date from the crawl-time post timestamp). Mirrors
 * `extractEventDate` steps 1-2 exactly. Exported for testing.
 */
export function hasExplicitEventDate(title: string, body: string, refDate: Date): boolean {
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
  const normalized = title.replaceAll("·", "•");
  const afterBullet = normalized.includes("•")
    ? normalized.split("•").pop()!.trim()
    : title;
  const titleClean = afterBullet.replaceAll(/#\d+/g, "").trim();
  return chronoParseDate(titleClean, "en-US", refDate, { forwardDate: true }) !== null;
}

/**
 * Turn one archived topic page into a RawEventData, or null when it isn't the
 * target forum, isn't a real topic, or has no EXPLICIT event date. Field
 * extraction mirrors the live adapter so backfill rows share its fingerprint
 * surface. Exported for testing.
 */
export function buildForumEvent(
  html: string,
  opts: { forumId: number; kennelTag: string; hashDay: string },
  preloaded$?: cheerio.CheerioAPI,
): RawEventData | null {
  const $ = preloaded$ ?? cheerio.load(html);
  if (extractTopicForumId($) !== opts.forumId) return null;

  const title = extractTopicTitle($);
  if (!title || isReplyEntry(title)) return null;

  const bodyHtml = extractFirstPostHtml(html);
  if (!bodyHtml) return null;

  const published = extractFirstPostPublished(html);
  if (!published) return null; // refuse to fabricate a reference date

  const bodyText = stripHtmlTags(bodyHtml, "\n");

  const refDate = new Date(published);
  if (Number.isNaN(refDate.getTime())) return null;
  if (!hasExplicitEventDate(title, bodyText, refDate)) return null;

  const date = extractEventDate(title, bodyText, published, opts.hashDay);
  if (!date) return null;

  const $body = cheerio.load(bodyHtml);
  const fields = extractEventFields(bodyHtml, bodyText, $body);

  // Uses the SAME (fixed) shared title parser as the live adapter, so SLUT's
  // "# NNN" and single-digit run numbers extract here too (#2504/#2511/#2519).
  const titleRunNumber = extractRunNumberFromTitle(title);

  const postId = extractFirstPostId(html);
  const sourceUrl = postId
    ? `${ORIGIN}/viewtopic.php?p=${postId}#p${postId}`
    : undefined;

  return {
    date,
    kennelTags: [opts.kennelTag],
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
  isForum: boolean;
  event: RawEventData | null;
}

async function harvestTopic(
  snap: TopicSnapshot,
  opts: { forumId: number; kennelTag: string; hashDay: string },
): Promise<HarvestResult> {
  const html = await fetchText(waybackRawUrl(snap.timestamp, snap.original));
  if (!html) return { isForum: false, event: null };
  const $ = cheerio.load(html);
  if (extractTopicForumId($) !== opts.forumId) return { isForum: false, event: null };
  return { isForum: true, event: buildForumEvent(html, opts, $) };
}

interface HarvestSummary {
  events: RawEventData[];
  forumTopics: number;
}

async function harvestAllTopics(
  snapshots: TopicSnapshot[],
  opts: { forumId: number; kennelTag: string; hashDay: string },
): Promise<HarvestSummary> {
  const events: RawEventData[] = [];
  let forumTopics = 0;
  for (let i = 0; i < snapshots.length; i += BATCH_SIZE) {
    const batch = snapshots.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((s) => harvestTopic(s, opts)));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "rejected") {
        console.warn(`  topic t=${batch[j].topicId}: harvest failed —`, r.reason);
        continue;
      }
      if (r.value.isForum) forumTopics++;
      if (r.value.event) events.push(r.value.event);
    }
    await sleep(POLITENESS_DELAY_MS);
  }
  return { events, forumTopics };
}

function dumpEvents(events: RawEventData[]): void {
  if (process.env.BACKFILL_DUMP !== "1") return;
  for (const e of [...events].sort((a, b) => a.date.localeCompare(b.date))) {
    console.log(`  DUMP ${e.date} | #${e.runNumber ?? "?"} | ${e.sourceUrl ?? "—"}`);
  }
}

/**
 * Run a full Wayback backfill for one Atlanta board forum: query CDX, filter to
 * the forum, parse explicit-date topics, and hand them to the shared runner
 * (partitions to `date < today(America/New_York)`, dedupes by fingerprint,
 * enforces the SourceKennel guard). Bound to the "Atlanta Hash Board" source.
 */
export function runAtlantaForumBackfill(opts: {
  forumId: number;
  kennelTag: string;
  hashDay: string;
  label: string;
}): Promise<void> {
  return runBackfillScript({
    sourceName: SOURCE_NAME,
    kennelTimezone: KENNEL_TIMEZONE,
    label: opts.label,
    fetchEvents: async () => {
      console.log("  Querying Wayback CDX for archived board.atlantahash.com topics...");
      const cdx = await fetchText(CDX_URL);
      if (!cdx) throw new Error("Wayback CDX query failed (no response after retries).");
      const snapshots = parseViewtopicCdx(cdx);
      console.log(
        `  ${snapshots.length} distinct archived topic(s) across all forums — ` +
          `filtering to ${opts.kennelTag} (f=${opts.forumId})...`,
      );
      const { events, forumTopics } = await harvestAllTopics(snapshots, opts);
      console.log(
        `  ${forumTopics} archived ${opts.kennelTag} topic(s); recovered ${events.length} ` +
          `with an explicit body/title date (${forumTopics - events.length} skipped — no explicit date / reply / no first post).`,
      );
      dumpEvents(events);
      return events;
    },
  });
}
