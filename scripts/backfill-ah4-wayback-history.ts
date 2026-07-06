/**
 * AH4 (Atlanta H4, the original Saturday Atlanta kennel) historical backfill
 * from the Internet Archive — issue #638. AH4 forum = f=2.
 *
 * The recurring Atlanta Hash Board scraper reads a ~15-topic Atom rolling window,
 * so past AH4 trails are only recoverable from the Internet Archive's crawled
 * `viewtopic.php` pages. All harvesting logic (CDX discovery, forum filtering via
 * the breadcrumb microdata, the explicit-date guard that refuses to fabricate a
 * date, and merge routing) lives in the shared scripts/lib/atlanta-wayback-
 * backfill.ts — this file is the AH4 entry point plus test-facing re-exports.
 *
 * Usage: [BACKFILL_APPLY=1] [BACKFILL_DUMP=1] npx tsx scripts/backfill-ah4-wayback-history.ts
 */
import "dotenv/config";
import type * as cheerio from "cheerio";
import type { RawEventData } from "@/adapters/types";
import {
  buildForumEvent,
  runAtlantaForumBackfillCli,
} from "./lib/atlanta-wayback-backfill";

// Re-export the shared harvester helpers under this module's public surface so
// the existing backfill-ah4-wayback-history.test.ts keeps importing from here.
export {
  parseViewtopicCdx,
  waybackRawUrl,
  extractTopicForumId,
  extractTopicTitle,
  hasExplicitEventDate,
  type TopicSnapshot,
} from "./lib/atlanta-wayback-backfill";

const AH4 = { forumId: 2, kennelTag: "ah4", hashDay: "Saturday" } as const;

/** AH4-bound wrapper around the shared `buildForumEvent` (forum f=2). */
export function buildAh4Event(
  html: string,
  preloaded$?: cheerio.CheerioAPI,
): RawEventData | null {
  return buildForumEvent(html, AH4, preloaded$);
}

runAtlantaForumBackfillCli({
  ...AH4,
  label: "Harvesting Wayback-archived AH4 forum topics (board.atlantahash.com is down)",
  scriptName: "backfill-ah4-wayback-history.ts",
});
