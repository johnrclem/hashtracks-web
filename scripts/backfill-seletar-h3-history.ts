/**
 * One-shot historical backfill for Seletar H3 (Singapore).
 *
 * Per `feedback_historical_backfill` memory: the recurring SeletarH3Adapter
 * pulls only future events (`hl_datetime >= CURDATE()`); this script reaches
 * back to 1980-06-24 (the kennel's founding) and inserts every historical
 * trail in one shot. The two queries are strictly disjoint by date, so the
 * backfill cannot overlap or duplicate what the recurring adapter writes.
 *
 * Usage:
 *   1. Dry run first:  npx tsx scripts/backfill-seletar-h3-history.ts
 *   2. Execute:        BACKFILL_APPLY=1 npx tsx scripts/backfill-seletar-h3-history.ts
 *
 * Idempotency: HISTORICAL_SQL uses `hl_datetime < CURDATE()` and the
 * adapter uses `>= CURDATE()`, so re-running this script can never insert
 * a row that the adapter has produced. Within a re-run of the script
 * itself, the pre-fetch + filter pattern still dedupes against existing
 * rows for the same source via fingerprint matching, then a single
 * createMany inserts the rest.
 */

import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createScriptPool } from "./lib/db-pool";
import {
  fetchSeletarRows,
  groupSeletarRows,
  HISTORICAL_SQL,
  SELETAR_API_URL_DEFAULT,
} from "@/adapters/html-scraper/seletar-h3";
import { generateFingerprint } from "@/pipeline/fingerprint";
import type { RawEventData } from "@/adapters/types";

const KENNEL_CODE = "seletar-h3";
const SOURCE_NAME = "Seletar H3 PWA";

async function main() {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);

  // One-shot script uses the default API endpoint. The recurring adapter
  // reads source.url from the DB, but that requires opening a DB connection
  // before the dry-run fetch — not worth the extra round trip for a URL
  // that hasn't changed since the kennel was founded. If the endpoint ever
  // moves, update SELETAR_API_URL_DEFAULT in the adapter.
  const apiUrl = SELETAR_API_URL_DEFAULT;
  const result = await fetchSeletarRows(apiUrl, HISTORICAL_SQL);
  if (result.error) throw new Error(`HashController API failed: ${result.error.message}`);
  console.log(`Fetched ${result.rows.length} historical rows (hl_datetime < CURDATE) from ${apiUrl}`);

  const grouped = groupSeletarRows(result.rows);
  const allEvents: RawEventData[] = grouped.events;
  console.log(`Grouped into ${allEvents.length} unique runs (skipped ${grouped.skippedRows} malformed rows)`);
  if (allEvents.length === 0) {
    console.log("No events to insert. Exiting.");
    return;
  }
  console.log(`Date range: ${allEvents[0].date} → ${allEvents.at(-1)!.date}`);

  console.log("\nFirst 3 sample events:");
  for (const e of allEvents.slice(0, 3)) {
    console.log(`  #${e.runNumber} ${e.date} | ${e.title} | hares=${e.hares ?? "-"} | loc=${e.location ?? "-"}`);
  }
  console.log("\nLast 3 sample events:");
  for (const e of allEvents.slice(-3)) {
    console.log(`  #${e.runNumber} ${e.date} | ${e.title} | hares=${e.hares ?? "-"} | loc=${e.location ?? "-"}`);
  }

  if (!apply) {
    console.log("\nDry run complete. Re-run with BACKFILL_APPLY=1 to write to DB.");
    return;
  }

  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const kennel = await prisma.kennel.findUnique({ where: { kennelCode: KENNEL_CODE } });
  if (!kennel) throw new Error(`Kennel ${KENNEL_CODE} not found in DB. Run prisma db seed first.`);
  const source = await prisma.source.findFirst({ where: { name: SOURCE_NAME } });
  if (!source) throw new Error(`Source ${SOURCE_NAME} not found in DB. Run prisma db seed first.`);

  // Compute fingerprints once, then dedup against the DB in a single round trip.
  const allFingerprints = allEvents.map((event) => ({
    event,
    fingerprint: generateFingerprint(event),
  }));
  const fingerprintList = allFingerprints.map((x) => x.fingerprint);
  const existingRows = await prisma.rawEvent.findMany({
    where: { sourceId: source.id, fingerprint: { in: fingerprintList } },
    select: { fingerprint: true },
  });
  const existingSet = new Set(existingRows.map((r) => r.fingerprint));
  const toInsert = allFingerprints.filter(({ fingerprint }) => !existingSet.has(fingerprint));
  console.log(`\nPre-existing rows: ${existingSet.size}. New rows to insert: ${toInsert.length}.`);

  if (toInsert.length === 0) {
    console.log("Nothing new to insert. Exiting.");
    await prisma.$disconnect();
    return;
  }

  // Single createMany — much faster than the per-row insert loop.
  await prisma.rawEvent.createMany({
    data: toInsert.map(({ event, fingerprint }) => ({
      sourceId: source.id,
      rawData: event as unknown as Prisma.InputJsonValue,
      fingerprint,
      processed: false,
    })),
  });

  console.log(`\nDone. Inserted ${toInsert.length} new RawEvents from ${apiUrl}.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
