import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createScriptPool } from "./db-pool";
import { generateFingerprint } from "@/pipeline/fingerprint";
import type { RawEventData } from "@/adapters/types";

export interface InsertRawEventsResult {
  preExisting: number;
  inserted: number;
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
