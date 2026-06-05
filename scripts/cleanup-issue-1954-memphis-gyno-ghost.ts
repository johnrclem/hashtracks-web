/**
 * One-shot cleanup for issue #1954 — Memphis H3 / GyNO H3 cross-kennel ghost.
 *
 * The GyNO H3 "Harriette Happy Hour" (Jun 4 2026) appears twice: correctly as
 * `gynoh3` (from the GyNO-pattern-routed Google Calendar) and incorrectly as
 * `mh3-tn` (from the Memphis H3 Facebook Hosted Events source, which hard-tags
 * the page kennel and can't route sister-kennel events). This PR adds a
 * `silentlySkipPatterns` rule so the FB source stops emitting the GyNO event;
 * this script removes the already-persisted `mh3-tn` ghost.
 *
 * Safety:
 *  - Re-queries by SIGNATURE (title + date + primary kennel) rather than a
 *    frozen id, so it no-ops if the ghost already self-healed.
 *  - Only deletes an `mh3-tn` ghost when a `gynoh3` twin for the same date
 *    still exists — never removes the sole copy of the event.
 *  - `deleteLeakedEvent` refuses if any attendance/check-in rows appeared.
 *  - Recomputes `Kennel.lastEventDate` afterward (matches the nightly backfill).
 *
 * Run manually (NOT in CI), after `npx prisma db seed` has applied the FB
 * source's `silentlySkipPatterns`:
 *   eval "$(fnm env)" && fnm use 20 && npx tsx scripts/cleanup-issue-1954-memphis-gyno-ghost.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { deleteLeakedEvent } from "./lib/delete-leaked-event";
import { backfillLastEventDates } from "@/pipeline/backfill-last-event";

const EVENT_DATE = "2026-06-04";
const TITLE_NEEDLE = "Harriette Happy Hour";

interface Row {
  id: string;
  title: string;
  kennelCode: string;
}

async function main() {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT e.id, e.title, k."kennelCode" AS "kennelCode"
    FROM "Event" e
    JOIN "EventKennel" ek ON ek."eventId" = e.id AND ek."isPrimary" = true
    JOIN "Kennel" k ON k.id = ek."kennelId"
    WHERE e.title ILIKE ${"%" + TITLE_NEEDLE + "%"}
      AND e."dateUtc"::date = ${EVENT_DATE}::date
  `;

  console.log(`Matched ${rows.length} event(s) for "${TITLE_NEEDLE}" on ${EVENT_DATE}:`);
  for (const r of rows) console.log(`  - ${r.id}  [${r.kennelCode}]  ${r.title}`);

  const ghosts = rows.filter((r) => r.kennelCode === "mh3-tn");
  const twins = rows.filter((r) => r.kennelCode === "gynoh3");

  if (ghosts.length === 0) {
    console.log("No mh3-tn ghost present — already healed. Nothing to do.");
    return;
  }
  if (twins.length === 0) {
    console.error(
      "Refusing to delete: no gynoh3 twin found for this date. The mh3-tn event " +
        "may be the only copy — investigate before deleting.",
    );
    process.exitCode = 1;
    return;
  }

  for (const ghost of ghosts) {
    console.log(`\nDeleting mh3-tn ghost ${ghost.id} ...`);
    await deleteLeakedEvent(prisma, ghost.id, ["hares", "attendances", "kennelAttendances"]);
  }

  const updated = await backfillLastEventDates();
  console.log(`\nRecomputed lastEventDate (${updated} kennel row(s) updated).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
