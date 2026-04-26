/**
 * One-shot merge for orphan RawEvents.
 *
 * Backfill scripts that used `insertRawEventsForSource` (now deleted) wrote
 * RawEvents directly with `processed = false`, expecting a follow-up scrape
 * to merge them. But `scrapeSource` only processes events returned by the
 * live adapter fetch — pre-inserted historical RawEvents stay orphaned
 * forever.
 *
 * This script extracts orphan RawEvents, writes a JSON backup to /tmp,
 * deletes the orphans, then re-runs them through `processRawEvents`, which
 * creates fresh RawEvent rows AND upserts canonical Events in one pass.
 * Delete-then-process (vs. process-then-delete) is required because
 * `processRawEvents` calls `prisma.rawEvent.create` per row, which would
 * collide on fingerprint with the still-present orphans. The JSON backup
 * lets you replay if the merge fails mid-batch.
 *
 * Usage:
 *   Dry run:   npx tsx scripts/merge-orphan-rawevents.ts <sourceName>
 *   Apply:     MERGE_APPLY=1 npx tsx scripts/merge-orphan-rawevents.ts <sourceName>
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { prisma } from "@/lib/db";
import { processRawEvents } from "@/pipeline/merge";
import type { RawEventData } from "@/adapters/types";

async function main() {
  const sourceName = process.argv[2];
  if (!sourceName) {
    console.error('Usage: npx tsx scripts/merge-orphan-rawevents.ts "<sourceName>"');
    process.exit(1);
  }
  const apply = process.env.MERGE_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write)" : "DRY RUN (no writes)"}`);
  console.log(`Source: "${sourceName}"`);

  try {
    const sources = await prisma.source.findMany({
      where: { name: sourceName },
      select: { id: true },
    });
    if (sources.length !== 1) {
      throw new Error(
        `Expected exactly 1 source named "${sourceName}", found ${sources.length}`,
      );
    }
    const sourceId = sources[0].id;

    const orphans = await prisma.rawEvent.findMany({
      where: { sourceId, processed: false, eventId: null },
      select: { id: true, rawData: true },
    });
    console.log(`\nFound ${orphans.length} orphan RawEvents`);
    if (orphans.length === 0) {
      console.log("Nothing to do.");
      return;
    }

    const events = orphans.map((o) => o.rawData as unknown as RawEventData);
    const dates = events.map((e) => e.date).sort((a, b) => a.localeCompare(b));
    console.log(`Date range: ${dates[0]} → ${dates.at(-1)}`);

    if (!apply) {
      console.log("\nDry run complete. Re-run with MERGE_APPLY=1.");
      return;
    }

    // Safety net: write rawData to a JSON backup before deletion. If
    // processRawEvents fails mid-batch the orphan rawData isn't gone — we
    // can replay from this file.
    const backupPath = path.join(
      os.tmpdir(),
      `merge-orphans-${sourceId}-${Date.now()}.json`,
    );
    fs.writeFileSync(backupPath, JSON.stringify(events, null, 2));
    console.log(`\nBacked up ${events.length} events → ${backupPath}`);

    console.log(`Deleting ${orphans.length} orphans...`);
    const orphanIds = orphans.map((o) => o.id);
    await prisma.rawEvent.deleteMany({ where: { id: { in: orphanIds } } });

    console.log("Running merge pipeline...");
    const result = await processRawEvents(sourceId, events);
    console.log(
      `\nMerge result: created=${result.created} updated=${result.updated} ` +
        `skipped=${result.skipped} unmatched=${result.unmatched.length} ` +
        `blocked=${result.blocked} restored=${result.restored} ` +
        `eventErrors=${result.eventErrors}`,
    );
    if (result.blocked > 0) {
      console.warn(`  Blocked tags: ${result.blockedTags.join(", ")}`);
    }
    if (result.unmatched.length > 0) {
      console.warn(`  Unmatched tags: ${result.unmatched.join(", ")}`);
    }
    if (result.eventErrors > 0) {
      console.warn(
        `  Event errors (first 5):\n    ${result.eventErrorMessages.slice(0, 5).join("\n    ")}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
