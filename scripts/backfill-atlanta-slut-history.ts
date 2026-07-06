/**
 * SLUT H3 (sluth3) historical backfill from the Internet Archive — #2511.
 * SLUT forum = f=10. See scripts/lib/atlanta-wayback-backfill.ts for the shared
 * harvester (CDX discovery, forum filtering, explicit-date guard, merge routing).
 *
 * Usage: [BACKFILL_APPLY=1] [BACKFILL_DUMP=1] npx tsx scripts/backfill-atlanta-slut-history.ts
 */
import "dotenv/config";
import { runAtlantaForumBackfillCli } from "./lib/atlanta-wayback-backfill";

runAtlantaForumBackfillCli({
  forumId: 10,
  kennelTag: "sluth3",
  hashDay: "Thursday",
  label: "Harvesting Wayback-archived SLUT (f=10) forum topics",
  scriptName: "backfill-atlanta-slut-history.ts",
});
