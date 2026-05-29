/**
 * Bootstrap + populate the NCH3 Official Microsite source (#1765).
 *
 * The nch3.com microsite exposes ONE "current run" event richer than the SDH3
 * hareline (hares / location / cost / trail type). This script:
 *   1. Ensures the "NCH3 Official Microsite" Source row + its nch3-sd
 *      SourceKennel link exist (idempotent upsert). The canonical definition
 *      lives in `prisma/seed-data/sources.ts`; a later `prisma db seed`
 *      reconciles this row by (name, type) with no duplicate.
 *   2. Scrapes the live page via `NCH3Adapter` (this is the mandatory live
 *      adapter verification per .claude/rules/live-verification.md).
 *   3. Routes the (now-past) current run through the merge pipeline.
 *
 * Reconcile-safety: the seeded source carries `config.upcomingOnly: true`, so a
 * single-event scrape never cancels the many SDH3-sourced NCH3 events.
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-nch3-microsite-event.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-nch3-microsite-event.ts
 *   Env:       DATABASE_URL
 */

import "dotenv/config";
import type { Source, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { NCH3Adapter } from "@/adapters/html-scraper/nch3";
import { reportAndApplyBackfill } from "./lib/backfill-runner";
import { SOURCES } from "@/../prisma/seed-data/sources";

const SOURCE_NAME = "NCH3 Official Microsite";
const KENNEL_TIMEZONE = "America/Los_Angeles";

// Single source of truth: the canonical row lives in prisma/seed-data/sources.ts.
// We bootstrap from that definition so the row this script creates can't drift
// from what `prisma db seed` later reconciles by (name, type). Resolve via a
// throwing helper so the type narrows to non-undefined inside the functions.
function requireSeed() {
  const seed = SOURCES.find((s) => s.name === SOURCE_NAME && s.type === "HTML_SCRAPER");
  if (!seed) {
    throw new Error(`Seed definition for "${SOURCE_NAME}" not found in prisma/seed-data/sources.ts`);
  }
  return seed;
}
const SEED = requireSeed();
const SCRAPE_DAYS = SEED.scrapeDays ?? 30;

/** Find the source, or (apply only) create it + link its kennels from the seed
 *  definition. Dry-run returns a synthetic row sufficient for `adapter.fetch`
 *  (which only reads url). */
async function resolveSource(apply: boolean): Promise<Source> {
  const existing = await prisma.source.findFirst({
    where: { name: SOURCE_NAME, type: "HTML_SCRAPER" },
  });

  if (!apply) {
    if (existing) return existing;
    console.log("  (dry run) source not yet in DB — using synthetic row for the live fetch.");
    return { name: SEED.name, url: SEED.url, type: SEED.type } as unknown as Source;
  }

  const source =
    existing ??
    (await prisma.source.create({
      data: {
        name: SEED.name,
        url: SEED.url,
        type: SEED.type,
        trustLevel: SEED.trustLevel,
        scrapeFreq: SEED.scrapeFreq,
        scrapeDays: SEED.scrapeDays,
        config: SEED.config as Prisma.InputJsonValue,
      },
    }));

  // Always (re)ensure the kennel links via idempotent upsert — covers a prior
  // partial run that created the source but crashed before linking, which would
  // otherwise trip reportAndApplyBackfill's "no SourceKennel links" preflight.
  const kennels = await prisma.kennel.findMany({
    where: { kennelCode: { in: SEED.kennelCodes } },
    select: { id: true, kennelCode: true },
  });
  const kennelIdByCode = new Map(kennels.map((k) => [k.kennelCode, k.id]));
  for (const code of SEED.kennelCodes) {
    const kennelId = kennelIdByCode.get(code);
    if (!kennelId) throw new Error(`Kennel "${code}" not found — cannot link the new source.`);
    await prisma.sourceKennel.upsert({
      where: { sourceId_kennelId: { sourceId: source.id, kennelId } },
      update: {},
      create: { sourceId: source.id, kennelId },
    });
  }
  console.log(`  ${existing ? "✓ Ensured" : "+ Created"} source "${SOURCE_NAME}" + linked ${SEED.kennelCodes.join(", ")}.`);
  return source;
}

async function main(): Promise<void> {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`NCH3 microsite backfill: source="${SOURCE_NAME}"`);
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);

  try {
    const source = await resolveSource(apply);

    console.log(`\n[1/2] Scraping ${SEED.url} via NCH3Adapter...`);
    const result = await new NCH3Adapter().fetch(source, { days: SCRAPE_DAYS });
    if (result.errors && result.errors.length > 0) {
      console.warn(`  Adapter errors: ${result.errors.join("; ")}`);
    }
    console.log(`  Adapter returned ${result.events.length} event(s).`);

    console.log("\n[2/2] Reporting + applying...");
    await reportAndApplyBackfill({
      apply,
      sourceName: SOURCE_NAME,
      events: result.events,
      kennelTimezone: KENNEL_TIMEZONE,
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
