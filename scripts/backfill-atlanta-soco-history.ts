/**
 * Southern Coven H3 (SoCo, soco-h3) historical backfill from the Internet
 * Archive — #2523. SoCo forum = f=11. See scripts/lib/atlanta-wayback-backfill.ts
 * for the shared harvester. SoCo is a young kennel, so Wayback coverage of its
 * (recent) topics is thin — the script recovers whatever was archived.
 *
 * Usage: [BACKFILL_APPLY=1] [BACKFILL_DUMP=1] npx tsx scripts/backfill-atlanta-soco-history.ts
 */
import "dotenv/config";
import { runAtlantaForumBackfillCli } from "./lib/atlanta-wayback-backfill";

runAtlantaForumBackfillCli({
  forumId: 11,
  kennelTag: "soco-h3",
  hashDay: "Friday",
  label: "Harvesting Wayback-archived Southern Coven (f=11) forum topics",
  scriptName: "backfill-atlanta-soco-history.ts",
});
