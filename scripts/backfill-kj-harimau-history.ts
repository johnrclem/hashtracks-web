/**
 * One-shot historical backfill for KJ Harimau (Kelana Jaya Harimau H3, Malaysia).
 * Issue #1447.
 *
 * khhhkj.blogspot.com publishes weekly run announcements (plus
 * birthday/wedding posts which we filter out). The recurring KjHarimauAdapter
 * uses Blogger's default maxResults=25; this script bypasses that cap by
 * calling `fetchBloggerPosts(baseUrl, 500)` directly so the entire visible
 * archive comes back in one request (~38 distinct runs back to Run#1516 /
 * 2 Sep 2025 as of filing #1447).
 *
 * Reusable parser helpers — picks up #1446 fixes automatically:
 *   `parseKjHarimauBody`, `parseKjHarimauTitle` are imported from the
 *   adapter file. The post→event composition is replicated inline here
 *   because the adapter's fetch() method hardcodes maxResults=25 and is
 *   read-only to this workstream (WS3 owns kj-harimau.ts).
 *
 *   Local constants `RUN_TITLE_RE`, `KENNEL_TAG`, `DEFAULT_START_TIME`
 *   mirror the adapter's internal constants. These are filter/identity
 *   knobs (not parser shape); if WS3 ever changes them, this script will
 *   include extra unparseable posts at worst, which the date-parse step
 *   then drops. The actual extraction (body fields, title fields, date)
 *   flows through the imported helpers.
 *
 * Idempotency:
 *   The merge pipeline dedupes RawEvents by `(sourceId, fingerprint)`. The
 *   fingerprint is deterministic over the parsed payload, so a second apply
 *   pass is a no-op on every row.
 *
 * WS3 gating:
 *   Do NOT run with BACKFILL_APPLY=1 until #1446 (KJ Harimau parser bug
 *   fixes) is merged on origin/main. processRawEvents is fingerprint-deduped
 *   and immutable — applying with the buggy parser produces durable
 *   mis-extracted rows that the later #1446 fix does NOT retroactively
 *   repair.
 *
 * Coverage limit:
 *   Blogger only returns posts visible on the front page + paginated
 *   archive (up to maxResults=500). Very old posts may have rolled off.
 *
 * Usage:
 *   Dry run:  set -a && source .env && set +a && npx tsx scripts/backfill-kj-harimau-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-kj-harimau-history.ts
 *   Env:      DATABASE_URL, GOOGLE_CALENDAR_API_KEY (Blogger API v3 shares the key)
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { fetchBloggerPosts } from "@/adapters/blogger-api";
import {
  parseKjHarimauBody,
  parseKjHarimauTitle,
} from "@/adapters/html-scraper/kj-harimau";
import {
  decodeEntities,
  normalizeHaresField,
  stripHtmlTags,
} from "@/adapters/utils";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "KJ Harimau H3 Blog";
const BASE_URL = "https://khhhkj.blogspot.com";
const KENNEL_TIMEZONE = "Asia/Kuala_Lumpur";
const KENNEL_TAG = "kj-harimau";
const DEFAULT_START_TIME = "18:00";
const RUN_TITLE_RE = /^\s*Run\s*#?\s*:?\s*(\d+)/i;
const MAX_BLOGGER_POSTS = 500;

async function fetchEvents(): Promise<RawEventData[]> {
  console.log(`Fetching Blogger posts from ${BASE_URL} (max ${MAX_BLOGGER_POSTS})`);
  const bloggerResult = await fetchBloggerPosts(BASE_URL, MAX_BLOGGER_POSTS);
  if (bloggerResult.error) {
    throw new Error(`Blogger fetch failed: ${bloggerResult.error.message}`);
  }
  console.log(`  Fetched ${bloggerResult.posts.length} blog posts.`);

  const events: RawEventData[] = [];
  const seenRuns = new Set<string>();
  let filteredOut = 0;
  let undated = 0;
  let duplicatesSkipped = 0;

  for (const post of bloggerResult.posts) {
    const titleDecoded = decodeEntities(post.title);
    if (!RUN_TITLE_RE.test(titleDecoded)) {
      filteredOut++;
      continue;
    }

    const bodyText = stripHtmlTags(post.content, "\n");
    const body = parseKjHarimauBody(bodyText);
    const titleFields = parseKjHarimauTitle(titleDecoded);

    const date = body.date ?? titleFields.date;
    if (!date) {
      undated++;
      continue;
    }

    const runNumber = body.runNumber ?? titleFields.runNumber;
    const dedupKey = `${date}|${runNumber ?? ""}`;
    if (seenRuns.has(dedupKey)) {
      duplicatesSkipped++;
      continue;
    }
    seenRuns.add(dedupKey);

    const hares = normalizeHaresField(body.hare ?? titleFields.hare);
    const location = body.runsite ?? titleFields.runsite;
    const externalLinks: { url: string; label: string }[] = [];
    if (body.wazeUrl) externalLinks.push({ url: body.wazeUrl, label: "Waze" });
    const description = body.guestFee ? `Guest Fee: ${body.guestFee}` : undefined;

    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber,
      hares,
      location,
      locationUrl: body.mapsUrl,
      latitude: body.latitude,
      longitude: body.longitude,
      startTime: body.startTime ?? DEFAULT_START_TIME,
      sourceUrl: post.url,
      description,
      externalLinks: externalLinks.length > 0 ? externalLinks : undefined,
    });
  }

  console.log(
    `  Parsed ${events.length} unique runs (${filteredOut} non-run posts, ${undated} undated, ${duplicatesSkipped} duplicates).`,
  );
  return events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: `Walking khhhkj.blogspot.com (Blogger API, max ${MAX_BLOGGER_POSTS})`,
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
