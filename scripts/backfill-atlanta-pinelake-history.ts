/**
 * Pinelake H3 (ph3-atl) historical backfill from the Internet Archive — #2500.
 * Pinelake forum = f=4. See scripts/lib/atlanta-wayback-backfill.ts for the
 * shared harvester (CDX discovery, forum filtering, explicit-date guard, merge).
 *
 * Usage: [BACKFILL_APPLY=1] [BACKFILL_DUMP=1] npx tsx scripts/backfill-atlanta-pinelake-history.ts
 */
import "dotenv/config";
import { runAtlantaForumBackfillCli } from "./lib/atlanta-wayback-backfill";

runAtlantaForumBackfillCli({
  forumId: 4,
  kennelTag: "ph3-atl",
  hashDay: "Saturday",
  label: "Harvesting Wayback-archived Pinelake (f=4) forum topics",
  scriptName: "backfill-atlanta-pinelake-history.ts",
});
