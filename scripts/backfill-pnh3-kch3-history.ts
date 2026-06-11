/**
 * One-shot backfill: KCH3 + PNH3 historical trails from the kansascityh3.com
 * WordPress archive (#2110).
 *
 * PNH3 (Pearl Necklace H3, "Ladies Only") trails post to the same global KCH3
 * feed and were dropping off the recurring scrape's single page within ~2 weeks.
 * The adapter now paginates, but the recurring 365-day window can't reach the
 * pre-2025 archive (and a permanently wide window would enlarge reconcile's
 * cancel range). This script walks the full WordPress archive once and routes
 * the PAST slice through the live merge pipeline (`processRawEvents` — no
 * reconcile), so canonical Events are created in the same pass. Re-runnable:
 * `processRawEvents` short-circuits on existing fingerprints.
 *
 * Dry run:  npx tsx scripts/backfill-pnh3-kch3-history.ts
 * Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-pnh3-kch3-history.ts
 */
import "dotenv/config";
import { fetchAllWordPressPosts } from "@/adapters/wordpress-api";
import { processKCH3Post } from "@/adapters/html-scraper/kch3";
import { htmlToNewlineText } from "@/adapters/utils";
import type { RawEventData } from "@/adapters/types";
import { runBackfillScript } from "./lib/backfill-runner";

const SOURCE_NAME = "Kansas City H3 Website";
const KENNEL_TIMEZONE = "America/Chicago";
const BASE_URL = "https://kansascityh3.com/";

async function fetchEvents(): Promise<RawEventData[]> {
  // No `stopBefore` → walk the whole archive (back to ~2017). perPage=100 keeps
  // it to a handful of pages; maxPages=50 is a safe ceiling with fail-loud
  // truncation guards in fetchAllWordPressPosts.
  const posts = await fetchAllWordPressPosts(BASE_URL, { perPage: 100, maxPages: 50 });
  console.log(`  ${posts.length} WordPress posts fetched`);

  const events: RawEventData[] = [];
  for (const post of posts) {
    const event = processKCH3Post(
      post.title,
      htmlToNewlineText(post.content),
      post.url,
      post.date,
    );
    if (event) events.push(event);
  }
  const pnh3 = events.filter((e) => e.kennelTags[0] === "pnh3").length;
  console.log(`  ${events.length} parsed as trails (${pnh3} PNH3, ${events.length - pnh3} KCH3)`);
  return events;
}

if (process.argv[1]?.endsWith("backfill-pnh3-kch3-history.ts")) {
  runBackfillScript({
    sourceName: SOURCE_NAME,
    kennelTimezone: KENNEL_TIMEZONE,
    label: "Walking KCH3 WordPress archive (kansascityh3.com)",
    fetchEvents,
  }).catch((err: unknown) => {
    console.error("FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
