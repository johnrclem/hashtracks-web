/**
 * One-shot cleanup for issue #1709 — MTH3 (Mersey Thirstdays) duplicate
 * run-number canonical Events created by the next-runs segmenter before the
 * sub-split + dedup hardening (see src/adapters/html-scraper/mersey-thirstdays.ts).
 *
 * The documented symptom was a duplicate run 602 (one on its real date
 * 2026-05-28, a phantom twin on 2026-06-04) plus hares bleeding backward from
 * neighboring run blocks. A re-scrape + reconcile has since healed the original
 * 602 twin in prod, but this script removes any residual duplicate-run-number
 * rows the bug may have left and stays available as an idempotent guard.
 *
 * SAFETY — scoped to the next-runs page only:
 *   MTH3's PAST-runs page legitimately repeats numeric run numbers via letter
 *   suffixes (116a/116b/116c, 395a/395b → all numeric 116 / 395). Those are
 *   real, distinct events and MUST NOT be touched. The next-runs page numbers
 *   runs strictly sequentially, so a duplicate run number among
 *   next-runs-sourced Events is unambiguously the parse-bug artifact. We filter
 *   on `sourceUrl LIKE '%next-run-s%'` before grouping, so past-runs letter
 *   suffixes are never candidates.
 *
 * For each duplicate group the richest record (most populated detail fields,
 * tie-break newest `updatedAt`) is kept; the rest are hard-deleted via
 * `deleteLeakedEvent` (with the user-data abort guard) so a re-scrape can't
 * resurrect them, then a post-delete orphan check runs.
 *
 *   tsx scripts/cleanup-mth3-run-602-dup.ts          # dry-run
 *   tsx scripts/cleanup-mth3-run-602-dup.ts --apply  # destructive
 *
 * Per memory `feedback_script_env_loading.md` — `import "dotenv/config"`
 * because tsx doesn't auto-load .env.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { deleteLeakedEvent } from "./lib/delete-leaked-event";
import { verifyNoOrphans } from "./lib/verify-no-orphans";
import { parseApplyMode, resolveCleanupKennel } from "./lib/cleanup-cli";

const KENNEL_CODE = "mth3";
// The next-runs page is the only one with strictly-sequential run numbers, so
// duplicates there are parse-bug artifacts (past-runs letter suffixes are not).
// Path-anchored (leading slash) so it can't accidentally match some future
// MTH3 source URL that merely contains the substring elsewhere.
const NEXT_RUNS_URL_FRAGMENT = "/next-run-s";

interface Mth3Event {
  id: string;
  date: Date;
  runNumber: number | null;
  haresText: string | null;
  locationName: string | null;
  description: string | null;
  updatedAt: Date;
  _count: { hares: number; attendances: number; kennelAttendances: number; rawEvents: number };
}

/** Detail richness — keep the most-populated record in a duplicate group. */
function fieldRichness(e: Mth3Event): number {
  let n = 0;
  if (e.haresText) n++;
  if (e.locationName) n++;
  if (e.description) n++;
  return n;
}

/** Pick the keeper: richest, tie-broken by newest updatedAt. */
function pickKeeper(group: Mth3Event[]): Mth3Event {
  return group.reduce((best, cur) => {
    const dr = fieldRichness(cur) - fieldRichness(best);
    if (dr > 0) return cur;
    if (dr === 0 && cur.updatedAt > best.updatedAt) return cur;
    return best;
  });
}

async function main() {
  const apply = parseApplyMode();
  const kennel = await resolveCleanupKennel(prisma, KENNEL_CODE);
  if (!kennel) return;

  const events = (await prisma.event.findMany({
    where: {
      kennelId: kennel.id,
      runNumber: { not: null },
      sourceUrl: { contains: NEXT_RUNS_URL_FRAGMENT },
    },
    select: {
      id: true,
      date: true,
      runNumber: true,
      haresText: true,
      locationName: true,
      description: true,
      updatedAt: true,
      _count: { select: { hares: true, attendances: true, kennelAttendances: true, rawEvents: true } },
    },
    orderBy: [{ runNumber: "asc" }, { date: "asc" }],
  })) as Mth3Event[];

  // Group by runNumber; only groups with >1 row are duplicate-bug artifacts.
  const byRun = new Map<number, Mth3Event[]>();
  for (const e of events) {
    if (e.runNumber == null) continue;
    const arr = byRun.get(e.runNumber) ?? [];
    arr.push(e);
    byRun.set(e.runNumber, arr);
  }

  const toDelete: Mth3Event[] = [];
  for (const [run, group] of byRun) {
    if (group.length < 2) continue;
    const keeper = pickKeeper(group);
    const losers = group.filter((e) => e.id !== keeper.id);
    console.log(
      `\nRun #${run}: ${group.length} rows — keeping ${keeper.id} (${keeper.date.toISOString().slice(0, 10)}), ` +
        `deleting ${losers.length}:`,
    );
    for (const e of losers) {
      const c = e._count;
      console.log(
        `  ${e.id}  ${e.date.toISOString().slice(0, 10)}  att=${c.attendances}/ka=${c.kennelAttendances}/hares=${c.hares}/raw=${c.rawEvents}  haresText=${JSON.stringify(e.haresText)}`,
      );
      toDelete.push(e);
    }
  }

  console.log(`\nTotal duplicate next-runs Events to delete: ${toDelete.length}`);

  if (!apply || toDelete.length === 0) {
    if (!apply) console.log("\nDry-run complete. Re-run with --apply to delete.");
    return;
  }

  // Abort if any deletion target carries user data — a real event was caught
  // by the predicate or prod drifted since inspection.
  const withUserData = toDelete.filter(
    (e) => e._count.attendances > 0 || e._count.kennelAttendances > 0 || e._count.hares > 0,
  );
  if (withUserData.length > 0) {
    console.error(`\nABORT: ${withUserData.length} target(s) carry user data — refusing to hard-delete:`);
    for (const e of withUserData) {
      const c = e._count;
      console.error(`  ${e.id}  att=${c.attendances}/ka=${c.kennelAttendances}/hares=${c.hares}`);
    }
    process.exitCode = 1;
    return;
  }

  // rawEvents intentionally omitted from required-zero: a RawEvent backing is
  // expected for these scrape artifacts and is what the hard-delete removes.
  for (const e of toDelete) {
    await deleteLeakedEvent(prisma, e.id, ["hares", "attendances", "kennelAttendances"]);
  }
  console.log(`\nDeleted ${toDelete.length} duplicate Event(s).`);

  await verifyNoOrphans(prisma, toDelete.map((e) => e.id));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
