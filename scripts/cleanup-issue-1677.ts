/**
 * One-shot cleanup for issue #1677 — Moooouston H3 title leak.
 *
 * A single 2026-04-27 event was titled `**update**` because the Houston
 * Hash umbrella GCal had a bare-SUMMARY VEVENT and the adapter promoted
 * the description's first non-label line ("**update**") as the title.
 *
 * The `preferDefaultTitleOverDescription` flag added in this PR (set on
 * the Houston Hash Calendar source) prevents future leaks of the same
 * shape, but the existing Event row persists until cleaned up here. A
 * fresh scrape after this delete will recreate the event with the
 * correct `defaultTitles["moooouston-h3"]` title ("Moooouston H3 Trail").
 *
 * Safe to re-run: no-ops if the Event has already been deleted.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { deleteLeakedEvent } from "./lib/delete-leaked-event";

const EVENT_TO_DELETE = "cmn3qazho00l004l2jtkheqjn";

deleteLeakedEvent(prisma, EVENT_TO_DELETE)
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
