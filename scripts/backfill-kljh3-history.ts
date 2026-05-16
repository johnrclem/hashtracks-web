/**
 * One-shot historical backfill for KL Junior H3 (Malaysia).
 * Issue #1443.
 *
 * KLJ H3 publishes runs as WordPress posts at www.kljhhh.org. The recurring
 * KljH3Adapter fetches only the latest 20 posts; this script walks every WP
 * page via `/wp-json/wp/v2/posts?per_page=100&page=N` and ingests all
 * historical run announcements in one shot (~120 runs back to June 2015).
 *
 * Refactor history:
 *   The original script (PR #1313) inserted RawEvents directly via
 *   `prisma.rawEvent.createMany()` with a hardcoded 30-day-UTC cutoff. That
 *   left rows `processed: false`, did NOT create canonical Events, and used
 *   a non-timezone-aware cutoff. This version routes through
 *   `reportAndApplyBackfill` → `processRawEvents`, which:
 *     - partitions strictly to `date < today-in-Asia/Kuala_Lumpur`,
 *     - dedupes by `(sourceId, fingerprint)` (idempotent re-runs), and
 *     - upserts canonical Events in the same pass.
 *
 * Shared logic: the post→event transform is `parseKljPost()` exported from
 * `src/adapters/html-scraper/klj-h3.ts` so this script and the recurring
 * adapter agree on run-number regex, default start time, and field mapping.
 *
 * Usage:
 *   Dry run:  set -a && source .env && set +a && BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-kljh3-history.ts
 *   Execute:  BACKFILL_APPLY=1 BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-kljh3-history.ts
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { decodeEntities } from "@/adapters/utils";
import { parseKljPost } from "@/adapters/html-scraper/klj-h3";
import { safeFetch } from "@/adapters/safe-fetch";
import type { RawEventData } from "@/adapters/types";

const BASE_URL = "https://www.kljhhh.org";
const SOURCE_NAME = "KL Junior H3 Website";
const KENNEL_TIMEZONE = "Asia/Kuala_Lumpur";
const PER_PAGE = 100;

interface WpRawPost {
  title: { rendered: string };
  content: { rendered: string };
  link: string;
  date: string;
}

async function fetchAllPosts(): Promise<WpRawPost[]> {
  const posts: WpRawPost[] = [];
  for (let page = 1; page <= 50; page++) {
    const url = `${BASE_URL}/wp-json/wp/v2/posts?per_page=${PER_PAGE}&page=${page}&_fields=title,content,link,date`;
    const res = await safeFetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "HashTracks-Backfill/1.0",
      },
    });
    if (res.status === 400) break; // WP returns 400 when page > totalPages
    if (!res.ok) throw new Error(`Page ${page}: HTTP ${res.status}`);
    // Runtime shape check — don't trust `as T[]` assertions. A WP install
    // that returns an error envelope (e.g. `{code:"rest_no_route",...}`)
    // would otherwise silently coerce to `undefined` and break downstream.
    const batch: unknown = await res.json();
    if (!Array.isArray(batch)) {
      throw new Error(`Page ${page}: expected JSON array, got ${typeof batch}`);
    }
    if (batch.length === 0) break;
    posts.push(...(batch as WpRawPost[]));
    if (batch.length < PER_PAGE) break;
  }
  return posts;
}

async function fetchEvents(): Promise<RawEventData[]> {
  console.log(`Fetching all WordPress posts from ${BASE_URL}/wp-json/wp/v2/posts …`);
  const posts = await fetchAllPosts();
  console.log(`  Fetched ${posts.length} total posts.`);

  const events: RawEventData[] = [];
  let nonRun = 0;
  let noDate = 0;
  for (const post of posts) {
    const result = parseKljPost({
      title: decodeEntities(post.title.rendered),
      content: post.content.rendered,
      url: post.link,
      date: post.date,
    });
    if (result.ok) {
      events.push(result.event);
    } else if (result.reason === "not-run-post") {
      nonRun++;
    } else {
      noDate++;
    }
  }

  // Dedupe by (runNumber|date) in case WP pagination returns dupes.
  const seen = new Set<string>();
  const unique: RawEventData[] = [];
  for (const e of events) {
    const key = `${e.runNumber ?? ""}|${e.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
  }
  unique.sort((a, b) => a.date.localeCompare(b.date));
  console.log(
    `  Parsed ${unique.length} unique run events (${nonRun} non-run posts, ${noDate} undated run posts).`,
  );
  return unique;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Walking kljhhh.org WP REST archive (pages 1-50)",
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
