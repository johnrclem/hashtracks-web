/**
 * One-shot cleanup for the Richmond H3 shared-calendar mis-attribution (#2180).
 *
 * Background:
 *   "Richmond H3 Google Calendar"
 *   (979d12b454…f90ae8@group.calendar.google.com) is actually the shared
 *   "Richmond, BIB, Titanic, Chain Gang H3" calendar. With no `kennelPatterns`,
 *   every event routed to `rvah3`, so sister-kennel runs (BIBH3, Belle Isle,
 *   Chain Gang, TMFMH3, CHHH) and a test entry ("FAKE HASH #12673: Test Trail
 *   101") landed on the Richmond H3 kennel page. The test event's #12673 also
 *   polluted the "Latest Run" stat.
 *
 *   The seed fix adds `kennelPatterns: [["\\b(?:RH3|RVAH3)\\b", "rvah3"]]` +
 *   `strictKennelRouting: true`, so future scrapes route only RH3-token titles
 *   to rvah3 and drop the rest. RH3's real trails are served by the Meetup
 *   source; the sisters by their own sources. This script removes the already-
 *   ingested leaks (the forward fix doesn't touch them — the leaks predate the
 *   forward scrape window and reconcile never revisits them).
 *
 * Strategy (delete, not reassign — the sisters aren't linked to this source):
 *   - Find canonical `rvah3` Events that carry a RawEvent from this calendar
 *     source AND whose title does NOT contain the RH3 / RVAH3 token (the same
 *     whitelist the live config now enforces).
 *   - Delete each via the race-safe helper with `forbidForeignRawSourceId` set
 *     to this source's id: any Event a Meetup scrape has since merged onto
 *     (foreign RawEvent present) is KEPT, not hard-deleted. Events with
 *     attendances are also kept (logged for manual review).
 *   - Recompute lastEventDate so the kennel header reflects the survivors.
 *
 * Title-match (not live re-route) is deliberate: it doesn't depend on the GCal
 * fetch window, so it can't accidentally delete a legit *past* RH3 trail that a
 * forward-only fetch wouldn't re-surface. Every legit RH3 event on this calendar
 * carries "RH3" ("RH3 trail", "RH3 trail #1599 - …", "RH3 Medley of Mud #3");
 * every leak does not — verified against the live calendar.
 *
 * Usage:
 *   Dry run: npx tsx scripts/cleanup-rh3-calendar-leak.ts
 *   Apply:   npx tsx scripts/cleanup-rh3-calendar-leak.ts --apply
 *
 * Run AFTER `npx prisma db seed` (so the new routing config is live) and ideally
 * before the next scrape.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { backfillLastEventDates } from "@/pipeline/backfill-last-event";
import {
  deleteLeakedEvent,
  DeleteSafetyViolationError,
  ForeignRawSourceError,
} from "./lib/delete-leaked-event";

const SOURCE_NAME = "Richmond H3 Google Calendar";
const RVAH3 = "rvah3";
/** RH3's own events carry this token; leaks (BIBH3/Chain Gang/TMFMH3/FAKE…) don't. */
const RH3_TOKEN_RE = /\b(?:RH3|RVAH3)\b/i;

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);

  const [kennel, source] = await Promise.all([
    prisma.kennel.findUnique({ where: { kennelCode: RVAH3 }, select: { id: true } }),
    prisma.source.findFirst({ where: { name: SOURCE_NAME }, select: { id: true } }),
  ]);
  if (!kennel || !source) {
    console.error(`Missing anchor(s): rvah3=${!!kennel} source=${!!source}`);
    process.exitCode = 1;
    return;
  }

  // Canonical rvah3 events that have at least one RawEvent from this calendar.
  const events = await prisma.event.findMany({
    where: {
      kennelId: kennel.id,
      rawEvents: { some: { sourceId: source.id } },
    },
    select: { id: true, title: true, date: true },
    orderBy: { date: "asc" },
  });
  console.log(`rvah3 events sourced (in part) from this calendar: ${events.length}`);

  const leaks = events.filter((e) => !RH3_TOKEN_RE.test(e.title ?? ""));
  console.log(`Non-RH3 leaks to remove: ${leaks.length}`);

  let deleted = 0, keptForeign = 0, keptUnsafe = 0;
  for (const ev of leaks) {
    const day = ev.date.toISOString().slice(0, 10);
    const label = `${ev.id} (${day} "${ev.title ?? ""}")`;
    if (!apply) {
      console.log(`  WOULD DELETE ${label}`);
      deleted++;
      continue;
    }
    try {
      await deleteLeakedEvent(prisma, ev.id, ["attendances", "kennelAttendances"], source.id);
      console.log(`  DELETED ${label}`);
      deleted++;
    } catch (err) {
      if (err instanceof ForeignRawSourceError) {
        console.log(`  KEPT (another source merged onto it) ${label}`);
        keptForeign++;
      } else if (err instanceof DeleteSafetyViolationError) {
        console.log(`  KEPT (has attendances/hares — review manually) ${label}`);
        keptUnsafe++;
      } else {
        throw err;
      }
    }
  }

  console.log(
    `\n${apply ? "Applied" : "Would"}: delete ${deleted}` +
      (apply ? `, kept-foreign ${keptForeign}, kept-unsafe ${keptUnsafe}` : ""),
  );
  if (apply && deleted > 0) {
    const n = await backfillLastEventDates();
    console.log(`Recomputed lastEventDate for ${n} kennel(s).`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
