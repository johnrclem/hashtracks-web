/**
 * One-shot: fill `runNumber` on past PFH3 canonical Events the live adapter
 * can no longer reach.
 *
 * #2043 taught the STATIC_SCHEDULE adapter to compute run numbers from the
 * PFH3 anchor (Trail #1184 @ 2019-11-20, biweekly Wednesdays). A normal scrape
 * sets them on events inside the ±90-day window, but PFH3 already had canonical
 * events OUTSIDE that window — past biweekly Wednesdays (2025-12-10 →
 * 2026-03-04) created by pre-feature scrapes — that the adapter never revisits
 * (it only projects forward). A wide back-window re-scrape was rejected because
 * reconcile could cancel the off-cadence signature events (Sat/Fri specials +
 * the New Year's campout). This script fills only the genuine on-cadence runs.
 *
 * Cadence guard: each null event's calendar date (normalized to UTC noon) must
 * be an exact integer number of 14-day steps from the anchor. The 4 specials
 * (non-Wednesday, or an off-sequence Wednesday) fail that test and are left
 * null — faithful to source (they are not numbered biweekly trails). Run number
 * is computed by the same exported `computeRunNumber` the adapter uses, so the
 * values match a future in-window scrape exactly (idempotent / no drift).
 *
 * Direct `Event.update` is the right tool here: these events are out-of-window
 * so they cannot be re-merged through the adapter, and only `runNumber` is
 * filled (no fingerprint-bearing field changes). Idempotent — re-running only
 * sees events still `runNumber: null`.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-pfh3-runnumbers.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-pfh3-runnumbers.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { computeRunNumber } from "@/adapters/static-schedule/adapter";

const KENNEL_CODE = "pfh3";
const ANCHOR_MS = Date.UTC(2019, 10, 20, 12, 0, 0); // Trail #1184 @ 2019-11-20 (UTC noon)
const START_RUN_NUMBER = 1184;
const INTERVAL_DAYS = 14; // biweekly
const DAY_MS = 86_400_000;

async function main(): Promise<void> {
  try {
    const apply = process.env.BACKFILL_APPLY === "1";
    console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);

    const events = await prisma.event.findMany({
      where: {
        eventKennels: { some: { kennel: { kennelCode: KENNEL_CODE } } },
        runNumber: null,
      },
      select: { id: true, dateUtc: true, title: true },
      orderBy: { dateUtc: "asc" },
    });

    const toSet: { id: string; dateStr: string; runNumber: number; title: string | null }[] = [];
    const skipped: { dateStr: string; title: string | null }[] = [];

    for (const e of events) {
      const d = e.dateUtc;
      const dateStr = d ? d.toISOString().slice(0, 10) : "(no date)";
      if (!d) {
        skipped.push({ dateStr, title: e.title });
        continue;
      }
      // Normalize to the calendar date at UTC noon — events are stored at their
      // real UTC start time (e.g. 23:30 = 18:30 ET), so a raw diff carries a
      // constant time-of-day offset that would defeat the integer-steps test.
      const normMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0);
      const steps = (normMs - ANCHOR_MS) / (INTERVAL_DAYS * DAY_MS);
      if (!Number.isInteger(steps)) {
        skipped.push({ dateStr, title: e.title }); // off-cadence special — leave null
        continue;
      }
      toSet.push({ id: e.id, dateStr, runNumber: computeRunNumber(dateStr, ANCHOR_MS, START_RUN_NUMBER, INTERVAL_DAYS), title: e.title });
    }

    console.log(`\n${events.length} null-runNumber PFH3 events: ${toSet.length} on-cadence to fill, ${skipped.length} off-cadence skipped`);
    for (const e of toSet) console.log(`  SET  #${e.runNumber}  ${e.dateStr}  | ${e.title ?? "—"}`);
    for (const e of skipped) console.log(`  SKIP        ${e.dateStr}  | ${e.title ?? "—"}`);

    if (!apply) {
      console.log("\nDry run complete. Re-run with BACKFILL_APPLY=1 to write to DB.");
      return;
    }
    if (toSet.length === 0) {
      console.log("\nNothing to fill. Exiting.");
      return;
    }

    for (const e of toSet) {
      await prisma.event.update({ where: { id: e.id }, data: { runNumber: e.runNumber } });
    }
    console.log(`\nApplied: ${toSet.length} events updated.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
