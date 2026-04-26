/**
 * One-shot merge for orphan RawEvents.
 *
 * Backfill scripts that use `insertRawEventsForSource` write RawEvents
 * directly with `processed = false`, expecting a follow-up scrape to merge
 * them. But `scrapeSource` only processes events returned by the live
 * adapter fetch — pre-inserted historical RawEvents stay orphaned forever.
 *
 * This script extracts orphan RawEvents, deletes them, and re-runs them
 * through `processRawEvents`, which creates fresh RawEvent rows AND upserts
 * canonical Events in the same pass.
 *
 * Usage:
 *   Dry run:   npx tsx scripts/merge-orphan-rawevents.ts <sourceName>
 *   Apply:     MERGE_APPLY=1 npx tsx scripts/merge-orphan-rawevents.ts <sourceName>
 *
 *   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 if running against the Railway proxy.
 */

import "dotenv/config";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createScriptPool } from "./lib/db-pool";
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

  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

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

    // processRawEvents calls prisma.rawEvent.create per row, so the orphans
    // must be deleted first to avoid a duplicate row per fingerprint.
    console.log(`\nDeleting ${orphans.length} orphans...`);
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
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
