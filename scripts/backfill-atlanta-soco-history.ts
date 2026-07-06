/**
 * Southern Coven H3 (SoCo, soco-h3) historical backfill from the Internet
 * Archive — issue #2523.
 *
 * The Atlanta Hash Board is live but its Atom feed only exposes ~15 recent
 * topics, so HashTracks tracks 8 SoCo events while the board's Southern Coven
 * forum (f=11) holds more. A wide-window re-scrape is unsafe (the reconciler
 * would cancel live events the feed no longer lists), so this one-shot harvests
 * the Archive's crawled SoCo topic pages instead. SoCo is a young kennel, so
 * Wayback coverage of its (recent) topics may be thin — the script recovers
 * whatever was archived.
 *
 * All shared logic lives in scripts/lib/atlanta-wayback-backfill.ts. `soco-h3`
 * is already SourceKennel-linked to "Atlanta Hash Board", and the runner
 * partitions to `date < today(America/New_York)` so the live forward window is
 * untouched.
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-atlanta-soco-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-atlanta-soco-history.ts
 *   Env:       DATABASE_URL
 */
import "dotenv/config";
import { runAtlantaForumBackfill } from "./lib/atlanta-wayback-backfill";

if (process.argv[1]?.endsWith("backfill-atlanta-soco-history.ts")) {
  runAtlantaForumBackfill({
    forumId: 11,
    kennelTag: "soco-h3",
    hashDay: "Friday",
    label: "Harvesting Wayback-archived Southern Coven (f=11) forum topics",
  }).catch((err: unknown) => {
    console.error("FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
