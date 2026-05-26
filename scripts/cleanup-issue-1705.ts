/**
 * One-shot cleanup for issue #1705 — Mosquito H3 title leak.
 *
 * A single 2025-08-06 event was titled "Broke back ranger is laying a 3
 * mil3 a to a." because the Houston Hash umbrella GCal had a bare-SUMMARY
 * VEVENT and the adapter promoted the description's first non-label line
 * (a freeform trail-prose sentence) as the title.
 *
 * The `preferDefaultTitleOverDescription` flag plus the new
 * `defaultTitles["mosquito-h3"]` entry added in this PR (both on the
 * Houston Hash Calendar source) prevent future leaks of the same shape.
 * A fresh scrape after this delete will recreate the event with the
 * correct title ("Mosquito H3 Trail").
 *
 * Safe to re-run: no-ops if the Event has already been deleted.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { deleteLeakedEvent } from "./lib/delete-leaked-event";

const EVENT_TO_DELETE = "cmn3qacn9007604l2pnlvms0u";

deleteLeakedEvent(prisma, EVENT_TO_DELETE)
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
