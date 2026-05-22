/**
 * One-shot backfill for #1562: Meetup-sourced canonical Events whose
 * `runNumber` is NULL despite a `#NNNN` token sitting in the title. The
 * Meetup adapter never extracted run numbers before; PR for #1562 wires
 * `extractHashRunNumber` into `buildRawEventFromApollo`, gated by the
 * per-source `extractRunNumber: true` config flag. The merge pipeline only
 * writes `runNumber` at canonical-Event creation — already persisted Events
 * stay null on re-scrape because the fingerprint matches.
 *
 * This script bridges that gap: scan Events with NULL runNumber whose
 * underlying MEETUP source has opted in via `extractRunNumber: true`,
 * re-apply `extractHashRunNumber` to the persisted title, and UPDATE the
 * Event row directly. Scoping to opted-in sources matches production
 * behavior — sources that haven't been audited for safe title conventions
 * never get spurious run numbers backfilled.
 *
 * Usage:
 *   npx tsx scripts/backfill-meetup-run-numbers.ts          # dry run
 *   BACKFILL_APPLY=1 npx tsx scripts/backfill-meetup-run-numbers.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { extractHashRunNumber } from "../src/adapters/utils";
import { createScriptPool } from "./lib/db-pool";

const apply = process.env.BACKFILL_APPLY === "1";

async function main() {
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  console.log(apply ? "✏️  APPLYING changes\n" : "🔍 DRY RUN — no changes will be made\n");

  // Find every MEETUP source that has opted into runNumber extraction. Only
  // these sources should drive backfill — others may carry false-positive
  // `#N` tokens in titles (e.g. "Pub Crawl #2") that shouldn't promote to
  // canonical runNumber.
  const meetupSources = await prisma.source.findMany({
    where: { type: "MEETUP" },
    select: { id: true, name: true, config: true },
  });
  const optedIn = meetupSources.filter((s) => {
    const cfg = s.config as { extractRunNumber?: boolean } | null;
    return cfg?.extractRunNumber === true;
  });
  if (optedIn.length === 0) {
    console.log("No Meetup sources have extractRunNumber: true in config. Nothing to backfill.");
    await pool.end();
    return;
  }
  console.log(`Opted-in sources (${optedIn.length}):`);
  for (const s of optedIn) console.log(`  - ${s.name}`);
  console.log("");

  const optedInIds = optedIn.map((s) => s.id);
  const candidates = await prisma.event.findMany({
    where: {
      runNumber: null,
      title: { not: null },
      rawEvents: { some: { sourceId: { in: optedInIds } } },
    },
    select: {
      id: true,
      title: true,
      kennel: { select: { kennelCode: true, shortName: true } },
    },
  });

  console.log(`Found ${candidates.length} opted-in-Meetup-sourced Event(s) with NULL runNumber.\n`);

  const buckets = { applied: 0, missing: 0 };
  const perKennel = new Map<string, number>();

  for (const ev of candidates) {
    const rn = extractHashRunNumber(ev.title ?? undefined);
    if (rn === undefined) {
      buckets.missing++;
      continue;
    }
    const tag = ev.kennel.kennelCode;
    perKennel.set(tag, (perKennel.get(tag) ?? 0) + 1);
    console.log(`  ${tag.padEnd(12)} ${ev.id}: "${ev.title}" → #${rn}`);
    if (apply) {
      await prisma.event.update({ where: { id: ev.id }, data: { runNumber: rn } });
    }
    buckets.applied++;
  }

  console.log(`\nSummary:`);
  console.log(`  ${apply ? "Updated" : "Would update"}: ${buckets.applied}`);
  console.log(`  Skipped (no extractable runNumber): ${buckets.missing}`);
  if (perKennel.size > 0) {
    console.log(`\n  Per-kennel breakdown:`);
    for (const [tag, n] of [...perKennel.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${tag.padEnd(12)} ${n}`);
    }
  }
  if (!apply) console.log("\nRe-run with BACKFILL_APPLY=1 to commit.");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
