/**
 * One-shot historical backfill for Singapore Sunday H3 (sh3-sg) via Harrier
 * Central.
 *
 * The live HarrierCentralAdapter is future-only, so SG Sunday's past runs never
 * reach canonical Events (#2306). This pulls them from the hashruns.org global
 * past-runs feed (scripts/lib/hc-global-runs.ts), filtered to SG's
 * PublicKennelId, and routes the past slice through merge.
 *
 * IMPORTANT — depth reality: the kennel is at Run #800 (Est. 1994), but HC only
 * holds the runs the kennel actually entered, which is a RECENT subset, NOT all
 * 800. This recovers whatever the global feed exposes; the dry-run prints the
 * true #range. No title config (no defaultTitle) → merge synthesizes
 * "Singapore Sunday H3 Trail #N". Source carries upcomingOnly, so reconcile
 * never cancels these. Re-runnable via fingerprint dedup.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-sh3-sg-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-sh3-sg-history.ts
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { sweepGlobalRuns, mapRunToRawEvent } from "./lib/hc-global-runs";
import type { HarrierCentralConfig } from "@/adapters/harrier-central/adapter";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Singapore Sunday H3 Harrier Central";
const KENNEL_TAG = "sh3-sg";
const PUBLIC_KENNEL_ID = "7cb56a4d-dfe8-4dc3-aacd-6884cd8d3cc1";
const KENNEL_TIMEZONE = "Asia/Singapore";
const HISTORY_START = "2020-01-01"; // sweep wide; SG's HC adoption date unknown

// No defaultTitle in the live source → merge synthesizes the default title.
const CONFIG: HarrierCentralConfig = {};

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
  label: "Sweeping Singapore Sunday H3 Harrier Central global-runs archive",
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
