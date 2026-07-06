/**
 * Pinelake H3 (ph3-atl) historical backfill from the Internet Archive — #2500.
 *
 * The Atlanta Hash Board is live but its Atom feed only exposes ~15 recent
 * topics, so HashTracks tracks ~12 Pinelake events (all Jan 2026+) while the
 * board's Pinelake forum (f=4) holds ~78 topics back to Jun 2023. A wide-window
 * re-scrape is unsafe (the reconciler would cancel live events the feed no
 * longer lists), so this one-shot harvests the Archive's crawled Pinelake topic
 * pages instead.
 *
 * All shared logic lives in scripts/lib/atlanta-wayback-backfill.ts. `ph3-atl`
 * is already SourceKennel-linked to "Atlanta Hash Board", and the runner
 * partitions to `date < today(America/New_York)` so the live forward window is
 * untouched.
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-atlanta-pinelake-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-atlanta-pinelake-history.ts
 *   Dump rows: BACKFILL_DUMP=1  npx tsx scripts/backfill-atlanta-pinelake-history.ts
 *   Env:       DATABASE_URL
 */
import "dotenv/config";
import { runAtlantaForumBackfill } from "./lib/atlanta-wayback-backfill";

if (process.argv[1]?.endsWith("backfill-atlanta-pinelake-history.ts")) {
  runAtlantaForumBackfill({
    forumId: 4,
    kennelTag: "ph3-atl",
    hashDay: "Saturday",
    label: "Harvesting Wayback-archived Pinelake (f=4) forum topics",
  }).catch((err: unknown) => {
    console.error("FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
