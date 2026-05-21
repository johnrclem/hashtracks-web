/**
 * One-shot historical backfill for Las Vegas H3 (lvh3.org).
 * Issue #1480.
 *
 * The recurring LVH3Adapter scrapes a 180-day window (`source.scrapeDays`),
 * so events that predate the date HashTracks first started ingesting this
 * source were never captured. This script drives the same Tribe API
 * (`fetchTribeEvents`) plus the same per-event mapping (`buildLvh3RawEvent`)
 * to reach back to 2025-02-01 and ingest every `lvhhh`-routed event before
 * 2025-11-01. The 17-row window is strictly disjoint from what the recurring
 * adapter currently sees on HashTracks (oldest past row: 2025-11-01).
 *
 * Routing parity:
 *   Uses the same most-specific-wins rule as `LVH3Adapter.fetch()` — events
 *   co-tagged with `RPHHH` / `BASHHH` / `LVRDR` are NOT routed to `lv-h3`
 *   (issue #1479). The recurring adapter and this backfill must agree, or
 *   the recurring scrape will keep re-creating ghosts after a backfill pass.
 *
 * Idempotency:
 *   `reportAndApplyBackfill` routes rows through `processRawEvents`, which
 *   dedupes by fingerprint. Re-runs are safe no-ops on every row.
 *
 * Usage:
 *   Dry run:  set -a && source .env && set +a && npx tsx scripts/backfill-lvh3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-lvh3-history.ts
 *   Env:      DATABASE_URL (only the Tribe REST API is hit — no API key needed)
 */

import "dotenv/config";
import { prisma } from "@/lib/db";
import { runBackfillScript } from "./lib/backfill-runner";
import { fetchTribeEvents } from "@/adapters/tribe-events";
import {
  buildLvh3RawEvent,
  compileKennelRouter,
  LVH3_MAX_EVENTS,
  readLvh3RoutingConfig,
} from "@/adapters/html-scraper/lvh3";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Las Vegas H3 Events";
const KENNEL_TIMEZONE = "America/Los_Angeles";
const START_DATE = "2025-02-01";
const END_DATE_EXCLUSIVE = "2025-11-01";

async function fetchEvents(): Promise<RawEventData[]> {
  // Pull routing config from the seeded Source row so this backfill tracks
  // the recurring scrape automatically. Hardcoding these locally would
  // drift the moment seed changes (e.g. adding RPHHH ingest) and either
  // re-misfile historical co-tagged events or leave gaps that the recurring
  // scrape silently fills.
  //
  // findMany + length check mirrors the runner's own guard (`backfill-runner`
  // throws on multi-match too): silently picking one row when the seed has
  // duplicate names would be a worse outcome than failing here.
  const sources = await prisma.source.findMany({
    where: { name: SOURCE_NAME },
    take: 2,
  });
  if (sources.length === 0) {
    throw new Error(`Source "${SOURCE_NAME}" not found. Run prisma db seed first.`);
  }
  if (sources.length > 1) {
    throw new Error(
      `Multiple sources named "${SOURCE_NAME}" found (${sources.length}). Aborting to avoid reading config from the wrong one.`,
    );
  }
  const { baseUrl, kennelPatterns, sharedCalendarCategory, otherKennelCategories } =
    readLvh3RoutingConfig(sources[0]);
  const route = compileKennelRouter(kennelPatterns, null, {
    sharedCalendarCategory,
    otherKennelCategories,
  });

  console.warn(
    `Walking ${baseUrl} Tribe API from ${START_DATE} to ${END_DATE_EXCLUSIVE} (exclusive)…`,
  );
  // Use the same per-fetch cap as the recurring adapter so history and
  // recurring scrapes stay behaviorally symmetric — bumping the cap on
  // one path must bump it on the other.
  const result = await fetchTribeEvents(baseUrl, {
    perPage: 50,
    maxEvents: LVH3_MAX_EVENTS,
    startDate: START_DATE,
  });
  if (result.error) throw new Error(`Tribe API failed: ${result.error.message}`);
  console.warn(`  Fetched ${result.rawCount} raw tribe events.`);

  const events: RawEventData[] = [];
  for (const e of result.events) {
    if (e.date < START_DATE || e.date >= END_DATE_EXCLUSIVE) continue;
    // Backfill the lv-h3 cohort only — ASS H3 history already ran in
    // scripts/backfill-ass-h3-history.ts and lands fingerprints we don't
    // want to overwrite with a different mapping pass.
    const kennelTag = route(e.categorySlugs);
    if (kennelTag !== "lv-h3") continue;
    events.push(buildLvh3RawEvent(e, kennelTag, baseUrl));
  }
  console.warn(`  Matched ${events.length} lv-h3 events in the backfill window.`);
  return events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: `Walking lvh3.org Tribe API for lv-h3 history`,
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
