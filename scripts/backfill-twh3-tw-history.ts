/**
 * One-shot historical backfill for Taiwan H3 (twh3-tw) via Harrier Central.
 *
 * The live HarrierCentralAdapter is future-only, so Taiwan's past runs never
 * reach canonical Events (#2404 — 0 past events held). This pulls them from the
 * hashruns.org global past-runs feed (scripts/lib/hc-global-runs.ts), filtered
 * to Taiwan's PublicKennelId, and routes the past slice through merge.
 *
 * Recoverable depth = whatever HC holds: Taiwan adopted HC ~2021-12 (earliest
 * feed run #2428), so this recovers ~#2428 → present. Source carries
 * upcomingOnly, so reconcile never cancels these. Re-runnable via fingerprint
 * dedup.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-twh3-tw-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-twh3-tw-history.ts
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { sweepGlobalRuns, mapRunToRawEvent } from "./lib/hc-global-runs";
import type { HarrierCentralConfig } from "@/adapters/harrier-central/adapter";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Taiwan H3 Harrier Central";
const KENNEL_TAG = "twh3-tw";
const PUBLIC_KENNEL_ID = "f1330d14-e3b4-427a-9bea-639f18218804";
const KENNEL_TIMEZONE = "Asia/Taipei";
const HISTORY_START = "2021-01-01"; // HC era begins ~2021-12

// Mirrors prisma/seed-data/sources.ts "Taiwan H3 Harrier Central".config.
const CONFIG: HarrierCentralConfig = {
  defaultTitle: "Taiwan H3",
  staleTitleAliases: ["Placeholder event for TwH3"],
};

async function fetchEvents(): Promise<RawEventData[]> {
  const today = new Date().toISOString().slice(0, 10);
  const runs = await sweepGlobalRuns(HISTORY_START, today);
  const mine = runs.filter((r) => r.PublicKennelId === PUBLIC_KENNEL_ID);
  return mine
    .map((r) => mapRunToRawEvent(r, KENNEL_TAG, CONFIG))
    .filter((e): e is RawEventData => e !== null);
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Sweeping Taiwan H3 Harrier Central global-runs archive",
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
