/**
 * One-shot historical backfill for Puerto Galera H3 (pgh3).
 *
 * The PuertoGaleraHashAdapter only emits runs inside the scrape window. The full
 * Run List archive (the JSON behind pgh3.org's DataTable, `assets/php/runList.php`)
 * was mapped once with the adapter's exported `runListRowToEvent` and frozen into
 * `scripts/data/pgh3-history.json`: 965 runs, #940 (2008-08-09) → #1904
 * (2026-10-31). Rows bind to the live "Puerto Galera H3 Upcoming Runs" source.
 *
 * Re-runnable: `reportAndApplyBackfill` dedupes by fingerprint and loads only past
 * events (date < today in kennel timezone).
 *
 * Usage:
 *   Dry run:  BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-pgh3-history.ts
 *   Apply:    BACKFILL_ALLOW_SELF_SIGNED_CERT=1 BACKFILL_APPLY=1 npx tsx scripts/backfill-pgh3-history.ts
 *
 * Requires the 20261106101100_onboard_pgh3 migration (source + kennel).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/pgh3-history.json";

runBackfillScript({
  sourceName: "Puerto Galera H3 Upcoming Runs",
  kennelTimezone: "Asia/Manila",
  label: "Loading frozen Puerto Galera H3 Run List archive",
  fetchEvents: async () => history as RawEventData[],
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
