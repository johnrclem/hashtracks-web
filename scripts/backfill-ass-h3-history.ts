/**
 * One-shot historical backfill for ASS H3 (Las Vegas).
 *
 * Per issue #733, the lvh3.org ASSH3 category has historical events that
 * predate the recurring adapter's scrape window and were never captured
 * (16 events in [2023-01-13, 2024-03-14] at time of writing — the issue
 * listed 8 in a narrower window). The recurring LVH3Adapter pulls events
 * within `source.scrapeDays` (default 365), so historical events outside
 * that window aren't visible to normal scrapes. This script reaches back
 * to 2023-01-01 and inserts every `assh3`-category event dated before
 * 2024-04-01 — strictly disjoint from what the recurring adapter produces.
 *
 * Usage:
 *   1. Dry run first:  npx tsx scripts/backfill-ass-h3-history.ts
 *   2. Execute:        BACKFILL_APPLY=1 npx tsx scripts/backfill-ass-h3-history.ts
 *
 * Idempotency: events are deduped against existing RawEvents for this source
 * by fingerprint before insert, so re-running is safe.
 */

import "dotenv/config";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createScriptPool } from "./lib/db-pool";
import { fetchTribeEvents } from "@/adapters/tribe-events";
import { buildLvh3RawEvent } from "@/adapters/html-scraper/lvh3";
import { generateFingerprint } from "@/pipeline/fingerprint";
import type { RawEventData } from "@/adapters/types";

const KENNEL_CODE = "ass-h3";
const SOURCE_NAME = "Las Vegas H3 Events";
const CATEGORY_SLUG = "assh3";
const START_DATE = "2023-01-01";
const END_DATE_EXCLUSIVE = "2024-04-01";
const BASE_URL = "https://lvh3.org";

async function main() {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);

  const result = await fetchTribeEvents(BASE_URL, {
    perPage: 50,
    maxEvents: 500,
    startDate: START_DATE,
  });
  if (result.error) throw new Error(`Tribe API failed: ${result.error.message}`);
  console.log(`Fetched ${result.rawCount} raw tribe events (startDate=${START_DATE})`);

  const allEvents: RawEventData[] = result.events
    .filter((e) => e.categorySlugs.map((c) => c.toLowerCase()).includes(CATEGORY_SLUG))
    .filter((e) => e.date >= START_DATE && e.date < END_DATE_EXCLUSIVE)
    .map((e) => buildLvh3RawEvent(e, KENNEL_CODE, BASE_URL))
    .sort((a, b) => a.date.localeCompare(b.date));

  console.log(
    `Matched ${allEvents.length} ASSH3 events in window [${START_DATE}, ${END_DATE_EXCLUSIVE})`,
  );
  if (allEvents.length === 0) {
    console.log("No events to insert. Exiting.");
    return;
  }

  const withHares = allEvents.filter((e) => e.hares).length;
  const withLocation = allEvents.filter((e) => e.location).length;
  console.log(
    `\nMatched events (${allEvents.length} total | ${withHares} with hares | ${withLocation} with location):`,
  );
  // Log titles only — hare names and street addresses are PII and would leak
  // into CI/deploy/operator logs. Run the dedicated verify script (local
  // read-only) if you need to eyeball the full payload.
  for (const e of allEvents) {
    console.log(`  ${e.date} | #${e.runNumber ?? "-"} ${e.title}`);
  }

  if (!apply) {
    console.log("\nDry run complete. Re-run with BACKFILL_APPLY=1 to write to DB.");
    return;
  }

  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const source = await prisma.source.findFirst({ where: { name: SOURCE_NAME } });
    if (!source) throw new Error(`Source "${SOURCE_NAME}" not found. Run prisma db seed first.`);

    const allFingerprints = allEvents.map((event) => ({
      event,
      fingerprint: generateFingerprint(event),
    }));
    const existingRows = await prisma.rawEvent.findMany({
      where: {
        sourceId: source.id,
        fingerprint: { in: allFingerprints.map((x) => x.fingerprint) },
      },
      select: { fingerprint: true },
    });
    const existingSet = new Set(existingRows.map((r) => r.fingerprint));
    const toInsert = allFingerprints.filter(({ fingerprint }) => !existingSet.has(fingerprint));
    console.log(
      `\nPre-existing rows: ${existingSet.size}. New rows to insert: ${toInsert.length}.`,
    );

    if (toInsert.length === 0) {
      console.log("Nothing new to insert. Exiting.");
      return;
    }

    await prisma.rawEvent.createMany({
      data: toInsert.map(({ event, fingerprint }) => ({
        sourceId: source.id,
        rawData: event as unknown as Prisma.InputJsonValue,
        fingerprint,
        processed: false,
      })),
    });

    console.log(`\nDone. Inserted ${toInsert.length} new RawEvents for ${KENNEL_CODE}.`);
  } finally {
    await Promise.allSettled([prisma.$disconnect(), pool.end()]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
