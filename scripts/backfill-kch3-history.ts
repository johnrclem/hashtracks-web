/**
 * One-shot historical backfill for KCH3 (Kansas City Hash) + sister kennel
 * PNH3 (Pearl Necklace). Issue #1370.
 *
 * `https://kansascityh3.com/` publishes every trail announcement (KCH3 +
 * PNH3) as a WordPress post. The live `KCH3Adapter` only requests the latest
 * 10 via `fetchWordPressPosts`; this script walks every WP REST API page via
 * `?per_page=100&page=N` (~535 total posts, 2018-05 → 2026-05) and ingests
 * the full archive in one shot.
 *
 * Two parser fixes (#1368, #1369) must land before this runs, or every
 * backfilled row inherits the broken year + AM/PM defaults and the merge
 * pipeline fingerprints the bad payload:
 *   - #1368: year-less titles like "28 February" need the WP publish date
 *     as the chrono refDate, not "today".
 *   - #1369: bare meetup times like "Meet Up 2:00" must default to PM.
 *
 * Both fixes live in `src/adapters/html-scraper/kch3.ts`; this script reuses
 * `processKCH3Post` directly so the live adapter and the backfill agree on
 * every parse rule. Kennel routing (KCH3 vs PNH3) is handled by
 * `resolveKennelTag` based on title text.
 *
 * Idempotency + strict partitioning:
 *   - `reportAndApplyBackfill` filters `date < todayInTimezone("America/Chicago")`
 *     before insert — the live adapter keeps owning current + upcoming.
 *   - The merge pipeline dedupes RawEvents by `(sourceId, fingerprint)`.
 *     A second apply pass is a no-op on every row.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-kch3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-kch3-history.ts
 *   Env:      DATABASE_URL
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { processKCH3Post } from "@/adapters/html-scraper/kch3";
import { fetchAllWordPressPosts } from "@/adapters/wordpress-api";
import { htmlToNewlineText } from "@/adapters/utils";
import type { RawEventData } from "@/adapters/types";

const BASE_URL = "https://kansascityh3.com";
const SOURCE_NAME = "Kansas City H3 Website";
const KENNEL_TIMEZONE = "America/Chicago";

async function fetchEvents(): Promise<RawEventData[]> {
  console.log(`Fetching WordPress posts from ${BASE_URL}/wp-json/wp/v2/posts …`);
  const posts = await fetchAllWordPressPosts(BASE_URL);
  console.log(`Fetched ${posts.length} total posts.\n`);

  const events: RawEventData[] = [];
  let unparseable = 0;
  for (const post of posts) {
    const bodyText = htmlToNewlineText(post.content);
    const event = processKCH3Post(post.title, bodyText, post.url, post.date);
    if (event) {
      events.push(event);
    } else {
      unparseable++;
    }
  }
  console.log(`Parsed ${events.length} events; ${unparseable} posts had no parseable date.`);

  // Per-kennel breakdown — helps confirm the KCH3-vs-PNH3 routing is sane.
  const tagCounts = new Map<string, number>();
  for (const e of events) {
    const tag = e.kennelTags[0];
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  console.log("Kennel routing:");
  for (const [tag, count] of [...tagCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${tag}: ${count}`);
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  return events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "KCH3 WP archive backfill (~535 posts, 2018-05 → 2026-05)",
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
