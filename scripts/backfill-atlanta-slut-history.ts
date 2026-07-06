/**
 * SLUT H3 (Short Lazy Urban Thursday, sluth3) historical backfill from the
 * Internet Archive — issue #2511.
 *
 * The Atlanta Hash Board is live but its Atom feed only exposes ~15 recent
 * topics, so HashTracks tracks 13 SLUT events while the board's SLUT forum
 * (f=10) holds ~35 topics back to SLUT #247 (Jun 2023). A wide-window re-scrape
 * is unsafe (the reconciler would cancel live events the feed no longer lists),
 * so this one-shot harvests the Archive's crawled SLUT topic pages instead.
 *
 * All shared logic lives in scripts/lib/atlanta-wayback-backfill.ts. `sluth3` is
 * already SourceKennel-linked to "Atlanta Hash Board", and the runner partitions
 * to `date < today(America/New_York)` so the live forward window is untouched.
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-atlanta-slut-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-atlanta-slut-history.ts
 *   Dump rows: BACKFILL_DUMP=1  npx tsx scripts/backfill-atlanta-slut-history.ts
 *   Env:       DATABASE_URL
 */
import "dotenv/config";
import { runAtlantaForumBackfill } from "./lib/atlanta-wayback-backfill";

if (process.argv[1]?.endsWith("backfill-atlanta-slut-history.ts")) {
  runAtlantaForumBackfill({
    forumId: 10,
    kennelTag: "sluth3",
    hashDay: "Thursday",
    label: "Harvesting Wayback-archived SLUT (f=10) forum topics",
  }).catch((err: unknown) => {
    console.error("FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
