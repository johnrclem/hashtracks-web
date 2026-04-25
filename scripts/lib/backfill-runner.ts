import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createScriptPool } from "./db-pool";
import { generateFingerprint } from "@/pipeline/fingerprint";
import { todayInTimezone } from "@/lib/timezone";
import type { RawEventData } from "@/adapters/types";

export interface InsertRawEventsResult {
  preExisting: number;
  inserted: number;
}

export interface BackfillReportOptions {
  apply: boolean;
  sourceName: string;
  events: RawEventData[];
  kennelTimezone: string;
}

/**
 * Shared report + apply phase for one-shot backfill scripts. Splits parsed
 * events into past (date < today-in-kennel-timezone) and skipped, prints a
 * partition summary plus three sample rows, and either short-circuits in dry
 * run mode or hands the past slice off to `insertRawEventsForSource`.
 *
 * Centralised here because every backfill repeats the same partition/report/
 * apply block verbatim, which trips SonarCloud's duplication gate.
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

  console.log("\nWriting to DB...");
  const { preExisting, inserted } = await insertRawEventsForSource(sourceName, past);
  console.log(`  Pre-existing: ${preExisting}. Inserted: ${inserted}.`);
  if (inserted > 0) {
    console.log(`\nDone. Trigger a scrape of "${sourceName}" from the admin UI to merge the new RawEvents.`);
  }
}

/**
 * Shared apply-phase for one-shot backfill scripts: looks up the source by
 * name, dedupes against existing RawEvent fingerprints, and batch-inserts the
 * remainder. Callers handle CLI flags, date partitioning, and reporting.
 *
 * Every backfill has to own pool/prisma lifecycle + source lookup + dedup
 * identically; diverging copies accumulate and fail SonarCloud duplication
 * gates on every new script.
 */
export async function insertRawEventsForSource(
  sourceName: string,
  events: RawEventData[],
): Promise<InsertRawEventsResult> {
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
    const source = sources[0];

    const withFingerprints = events.map((event) => ({
      event,
      fingerprint: generateFingerprint(event),
    }));
    const fingerprintList = withFingerprints.map((x) => x.fingerprint);
    const existingRows = await prisma.rawEvent.findMany({
      where: { sourceId: source.id, fingerprint: { in: fingerprintList } },
      select: { fingerprint: true },
    });
    const existingSet = new Set(existingRows.map((r) => r.fingerprint));
    const toInsert = withFingerprints.filter(({ fingerprint }) => !existingSet.has(fingerprint));

    if (toInsert.length > 0) {
      await prisma.rawEvent.createMany({
        data: toInsert.map(({ event, fingerprint }) => ({
          sourceId: source.id,
          rawData: event as unknown as Prisma.InputJsonValue,
          fingerprint,
          processed: false,
        })),
      });
    }

    return { preExisting: existingSet.size, inserted: toInsert.length };
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}
