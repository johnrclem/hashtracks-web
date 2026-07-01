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
import { runHcKennelBackfill } from "./lib/hc-global-runs";
import type { HarrierCentralConfig } from "@/adapters/harrier-central/adapter";

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

runHcKennelBackfill({
  sourceName: "Tokyo H3 Harrier Central",
  kennelTag: "tokyo-h3",
  publicKennelId: "57f5b2c6-8d8f-41e0-8dbf-d03a0a9aa10e",
  kennelTimezone: "Asia/Tokyo",
  historyStart: "2021-01-01", // HC era begins ~2021-09; start earlier to be safe
  config: CONFIG,
  label: "Sweeping Tokyo H3 Harrier Central global-runs archive",
});
