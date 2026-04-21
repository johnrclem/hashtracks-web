/**
 * One-shot restoration for events falsely cancelled by `reconcileStaleEvents`
 * on upcoming-only sources (GH #849).
 *
 * Before the reconcile upcoming-only fix, sources that only publish future runs
 * (e.g. sh3.link) saw every past run drop off the page and get flipped to
 * CANCELLED by reconcile. This script flips vetted rows back to CONFIRMED.
 *
 * Two-phase workflow (intentional — per review feedback, we never bulk-update
 * the full dry-run cohort without an operator reviewing each row first):
 *
 *   1. Dry run — enumerate candidate CANCELLED events that still have RawEvents
 *      from the supplied sources. Human reviews the list.
 *   2. Apply — re-run with `EVENT_IDS=<csv>` AND `RESTORE_APPLY=1`. Only the
 *      explicit ids are flipped, and only after we re-verify each is still
 *      CANCELLED and still in the candidate cohort.
 *
 * Usage:
 *   # default: Sydney H3, dry run
 *   npx tsx scripts/restore-reconcile-false-cancellations.ts
 *
 *   # apply, restricted to reviewed ids
 *   EVENT_IDS=evt_abc,evt_def RESTORE_APPLY=1 \
 *     npx tsx scripts/restore-reconcile-false-cancellations.ts
 *
 *   # other upcoming-only sources
 *   SOURCE_IDS=cmn...,cmx... npx tsx scripts/restore-reconcile-false-cancellations.ts
 */

import "dotenv/config";
import { EventStatus, PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createScriptPool } from "./lib/db-pool";

const DEFAULT_SOURCE_IDS = ["cmnt77pfl001mjjhn5zmwl9v8"]; // Sydney H3
const LOOKBACK_DAYS = 365;

async function main() {
  const apply = process.env.RESTORE_APPLY === "1";
  const sourceIds = (process.env.SOURCE_IDS ?? DEFAULT_SOURCE_IDS.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const reviewedIds = (process.env.EVENT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`Mode: ${apply ? "APPLY (will update DB)" : "DRY RUN (no writes)"}`);
  console.log(`Source IDs: ${sourceIds.join(", ")}`);
  if (reviewedIds.length > 0) {
    console.log(`Reviewed EVENT_IDS: ${reviewedIds.join(", ")}`);
  }

  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const now = new Date();
    const lookbackFloor = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);

    const events = await prisma.event.findMany({
      where: {
        status: EventStatus.CANCELLED,
        date: { gte: lookbackFloor, lt: now },
        rawEvents: { some: { sourceId: { in: sourceIds } } },
      },
      select: {
        id: true,
        date: true,
        kennel: { select: { shortName: true, kennelCode: true } },
      },
      orderBy: { date: "asc" },
    });

    console.log(`\nFound ${events.length} past CANCELLED events with RawEvents from these sources:\n`);
    for (const ev of events) {
      const dateStr = ev.date.toISOString().split("T")[0];
      console.log(`  ${dateStr}  ${ev.kennel.kennelCode.padEnd(20)} (${ev.kennel.shortName})  [${ev.id}]`);
    }

    if (!apply) {
      console.log(
        "\nDry run complete. To restore, re-run with RESTORE_APPLY=1 and " +
          "EVENT_IDS=<csv of ids from the list above>.\n" +
          "\n⚠️  WARNING: this cohort includes ANY past CANCELLED event that still has a\n" +
          "    RawEvent from the selected source(s). A row in this list could have been\n" +
          "    legitimately cancelled (hare called it off) and still appear here, since\n" +
          "    upcoming-only sources drop runs the same way whether they happen or get\n" +
          "    cancelled. Cross-check each id against the GH issue, attendance records,\n" +
          "    or kennel communications before including it in EVENT_IDS.",
      );
      return;
    }

    if (reviewedIds.length === 0) {
      console.error(
        "\nRefusing to apply without EVENT_IDS. Provide a reviewed subset of ids " +
          "(e.g. EVENT_IDS=evt_abc,evt_def) so we don't bulk-update the full cohort.",
      );
      process.exitCode = 1;
      return;
    }

    const candidateIds = new Set(events.map((e) => e.id));
    const toRestore = reviewedIds.filter((id) => candidateIds.has(id));
    const skipped = reviewedIds.filter((id) => !candidateIds.has(id));
    if (skipped.length > 0) {
      console.warn(
        `\nSkipping ${skipped.length} id(s) not in current candidate cohort ` +
          `(already restored, outside lookback, or no RawEvent from these sources): ${skipped.join(", ")}`,
      );
    }

    if (toRestore.length === 0) {
      console.log("Nothing to restore after filtering. Exiting.");
      return;
    }

    const updated = await prisma.event.updateMany({
      where: { id: { in: toRestore }, status: EventStatus.CANCELLED },
      data: { status: EventStatus.CONFIRMED },
    });
    console.log(`\nDone. Restored ${updated.count} Event(s) to CONFIRMED.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
