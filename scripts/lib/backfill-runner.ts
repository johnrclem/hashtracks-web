import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createScriptPool } from "./db-pool";
import { processRawEvents } from "@/pipeline/merge";
import { todayInTimezone } from "@/lib/timezone";
import type { RawEventData } from "@/adapters/types";

export interface BackfillReportOptions {
  apply: boolean;
  sourceName: string;
  events: RawEventData[];
  kennelTimezone: string;
}

/**
 * Shared report + apply phase for one-shot backfill scripts. Splits parsed
 * events into past (date < today-in-kennel-timezone) and skipped, prints a
 * partition summary plus three sample rows, and (in apply mode) routes the
 * past slice through the live merge pipeline so canonical Events are created
 * in the same pass — no orphan RawEvents, no follow-up scrape needed.
 *
 * Re-runnable: `processRawEvents` short-circuits on existing fingerprints.
 */
export async function reportAndApplyBackfill(
  options: BackfillReportOptions,
): Promise<void> {
  const { apply, sourceName, events, kennelTimezone } = options;
  const today = todayInTimezone(kennelTimezone);
  const past = events.filter((e) => e.date < today);
  const skipped = events.length - past.length;
  console.log(`  Partition: ${past.length} past rows, ${skipped} skipped (date >= ${today})`);

  past.sort((a, b) => a.date.localeCompare(b.date));
  if (past.length > 0) {
    console.log(`\nDate range: ${past[0].date} → ${past.at(-1)!.date}`);
    const sampleIdx = [0, Math.floor(past.length / 2), past.length - 1];
    console.log("Samples (oldest, middle, newest):");
    for (const i of sampleIdx) {
      const e = past[i];
      console.log(
        `  #${e.runNumber ?? "?"} ${e.date} | title=${e.title ?? "—"} | hares=${e.hares ?? "—"} | loc=${e.location ?? "—"} | start=${e.startTime ?? "—"}`,
      );
    }
  }

  if (!apply) {
    console.log("\nDry run complete. Re-run with BACKFILL_APPLY=1 to write to DB.");
    return;
  }
  if (past.length === 0) {
    console.log("\nNo events to insert. Exiting.");
    return;
  }

  console.log("\nMerging via pipeline...");
  await mergeRawEventsForSource(sourceName, past);
}

/**
 * Apply-phase: look up the source by name, preflight that at least one
 * SourceKennel link exists (otherwise the merge guard would silently block
 * every row), and route through `processRawEvents`. The merge pipeline
 * creates RawEvent rows AND upserts canonical Events in one pass; on re-run
 * it dedupes by fingerprint, so this is safely idempotent.
 *
 * NOTE: pre-inserting RawEvents and then "triggering a scrape" does NOT
 * merge them — `scrapeSource` only processes the live adapter's fetch
 * results. Always go through this helper, never `prisma.rawEvent.create`
 * directly.
 */
async function mergeRawEventsForSource(
  sourceName: string,
  events: RawEventData[],
): Promise<void> {
  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const sources = await prisma.source.findMany({
      where: { name: sourceName },
      select: { id: true },
    });
    if (sources.length === 0) {
      throw new Error(`Source "${sourceName}" not found in DB. Run prisma db seed first.`);
    }
    if (sources.length > 1) {
      throw new Error(
        `Multiple sources named "${sourceName}" found (${sources.length}). Aborting to avoid writing to the wrong one.`,
      );
    }
    const sourceId = sources[0].id;

    const linkCount = await prisma.sourceKennel.count({ where: { sourceId } });
    if (linkCount === 0) {
      throw new Error(
        `Source "${sourceName}" has no SourceKennel links. The merge guard would block every row. ` +
          `Link the source to its kennel(s) in admin before running this backfill.`,
      );
    }

    const result = await processRawEvents(sourceId, events);
    console.log(
      `  created=${result.created} updated=${result.updated} ` +
        `skipped=${result.skipped} blocked=${result.blocked} ` +
        `eventErrors=${result.eventErrors}`,
    );
    if (result.blocked > 0) {
      throw new Error(
        `${result.blocked} events BLOCKED by source-kennel guard (tags: ${result.blockedTags.join(", ")}). ` +
          `Preflight should have caught this — investigate before retrying.`,
      );
    }
    if (result.unmatched.length > 0) {
      console.warn(`  Unmatched kennel tags: ${result.unmatched.join(", ")}`);
    }
    if (result.eventErrors > 0) {
      const sample = result.eventErrorMessages.slice(0, 5).join("\n    ");
      console.warn(`  Event errors (first 5):\n    ${sample}`);
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}
