/**
 * One-shot historical backfill for Jamaica H3 (jah3).
 *
 * The JamaicaHashAdapter only emits runs inside the scrape window, so the full
 * "Receding Hare Line" archive (#001 13 Feb 1998 → #646 1 Nov 2026) would never
 * reach canonical Events. It was parsed once with the adapter's exported
 * `parseJamaicaHareline` over the live page (fetched via browserRender) and frozen
 * into `scripts/data/jah3-history.json` — committed as data, no parser, per the H7
 * lesson. Cancelled runs are already excluded. Rows bind to the live
 * "Jamaica H3 Website Hareline" source for provenance.
 *
 * Re-runnable: `reportAndApplyBackfill` dedupes by fingerprint and loads only past
 * events (date < today in kennel timezone).
 *
 * Usage:
 *   Dry run:  BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-jah3-history.ts
 *   Apply:    BACKFILL_ALLOW_SELF_SIGNED_CERT=1 BACKFILL_APPLY=1 npx tsx scripts/backfill-jah3-history.ts
 *
 * Requires the 20261106100000_onboard_jah3 migration (source + kennel).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import jah3History from "./data/jah3-history.json";

runBackfillScript({
  sourceName: "Jamaica H3 Website Hareline",
  kennelTimezone: "America/Jamaica",
  label: "Loading frozen Jamaica H3 Receding Hare Line archive",
  fetchEvents: async () => jah3History as RawEventData[],
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
