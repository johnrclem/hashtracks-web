/**
 * One-shot historical backfill for Tokyo H3 (tokyo-h3) via Harrier Central.
 *
 * The live HarrierCentralAdapter is future-only, so Tokyo's past runs never
 * reach canonical Events. This pulls them from the hashruns.org global past-runs
 * feed (see scripts/lib/hc-global-runs.ts), filtered to Tokyo's PublicKennelId,
 * and routes the past slice through the merge pipeline.
 *
 * Recoverable depth is whatever HC actually holds: Tokyo adopted HC ~2021-09
 * (earliest feed run #2339), NOT the kennel's 1976 founding — so this recovers
 * the HC era (~#2339 → present), not the full history (#2411).
 *
 * Config mirrors the live source (defaultTitle + Tokyo's neighborhood
 * `staleTitleAliases`) so titles match the recurring scrape. Source carries
 * upcomingOnly, so reconcile never cancels these past rows. Re-runnable:
 * processRawEvents dedupes by fingerprint.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-tokyo-h3-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-tokyo-h3-history.ts
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { sweepGlobalRuns, mapRunToRawEvent } from "./lib/hc-global-runs";
import type { HarrierCentralConfig } from "@/adapters/harrier-central/adapter";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Tokyo H3 Harrier Central";
const KENNEL_TAG = "tokyo-h3";
const PUBLIC_KENNEL_ID = "57f5b2c6-8d8f-41e0-8dbf-d03a0a9aa10e";
const KENNEL_TIMEZONE = "Asia/Tokyo";
const HISTORY_START = "2021-01-01"; // HC era begins ~2021-09; start earlier to be safe

// Mirrors prisma/seed-data/sources.ts "Tokyo H3 Harrier Central".config.
const CONFIG: HarrierCentralConfig = {
  defaultTitle: "Tokyo H3 Trail",
  staleTitleAliases: [
    "Akabane", "Akihabara", "Asakusa", "Ebisu", "Ginza", "Ikebukuro", "Iidabashi",
    "Kanda", "Meguro", "Nakameguro", "Nishiogikubo", "Roppongi", "Shibuya",
    "Shimbashi", "Shinagawa", "Shinjuku", "Suidobashi", "Takadanobaba",
    "Takadanobanba", "Tokyo", "Ueno", "Yotsuya",
  ],
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
  label: "Sweeping Tokyo H3 Harrier Central global-runs archive",
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
