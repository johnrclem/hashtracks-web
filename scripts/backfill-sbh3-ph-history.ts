/**
 * One-shot historical backfill for Subic Bay H3 (sbh3-ph).
 *
 * The SubicBayHashAdapter reads only the latest 25 Blogger posts, so older runs
 * would never reach canonical Events. The blog's full archive (195 posts, Oct
 * 2024 →) was parsed once with the adapter's exported `buildSubicBayEvents`
 * (newest "Hareline" row per run, enriched from its "Run N" recap) and frozen
 * into `scripts/data/sbh3-ph-history.json`: 109 runs, #1622 (2024-10-07) →
 * #1730 (2026-11-02). Runs #1–#1621 (1993 → Sept 2024) predate the blog.
 * "Hashstats" posts (member names) were never parsed. Rows bind to the live
 * "Subic Bay H3 Blogger Hareline" source.
 *
 * Re-runnable: `reportAndApplyBackfill` dedupes by fingerprint and loads only past
 * events (date < today in kennel timezone).
 *
 * Usage:
 *   Dry run:  BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-sbh3-ph-history.ts
 *   Apply:    BACKFILL_ALLOW_SELF_SIGNED_CERT=1 BACKFILL_APPLY=1 npx tsx scripts/backfill-sbh3-ph-history.ts
 *
 * Requires the 20261106100800_onboard_sbh3_ph migration (source + kennel).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/sbh3-ph-history.json";

runBackfillScript({
  sourceName: "Subic Bay H3 Blogger Hareline",
  kennelTimezone: "Asia/Manila",
  label: "Loading frozen Subic Bay H3 Hareline + recap archive",
  fetchEvents: async () => history as RawEventData[],
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
