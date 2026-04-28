/**
 * One-shot backfill for Chain Gang H3 (chain-gang-hhh) Trail #40 (AGM).
 *
 * Per issue #921, the Richmond H3 Meetup is a shared group hosting four
 * sister kennels. The MEETUP source's kennelPatterns at sources.ts:931 route
 * `^Chain Gang` → chain-gang-hhh, but Trail #40's title prefix
 * "ANNUAL GENERAL MEEING:" bypasses the anchor, so the event never lands
 * on chain-gang-hhh. The kennel page shows zero upcoming events as a result.
 *
 * Direct fixes are in adapter/seed territory (substring match instead of
 * anchored, OR add the RH3 Google Calendar `cac4504...` as a redundant
 * source) — both out of scope for this WS. This script inserts a single
 * RawEvent so the event lands today; the upstream pattern fix is tracked
 * as follow-up.
 *
 * Members-only: location and description are gated to Meetup members. We
 * have title/date/time/run-number from the public list view; that matches
 * what was previously stored for past Trail #39, so the data shape is
 * consistent.
 *
 * Calls `processRawEvents` inline because (a) the event is today (so the
 * `reportAndApplyBackfill` past-only filter would drop it) and (b) the
 * kennelTag override here ("chain-gang-hhh") doesn't match what the
 * recurring scrape would produce (defaultKennelTag "rvah3" since the
 * `^Chain Gang` pattern misses), so the next scrape would never reach
 * this RawEvent — fingerprints differ. Inline merge promotes it now.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-chain-gang-trail-40.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-chain-gang-trail-40.ts
 */

import "dotenv/config";
import { prisma } from "@/lib/db";
import { processRawEvents } from "@/pipeline/merge";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Richmond H3 Meetup";

const TRAIL_40: RawEventData[] = [
  {
    date: "2026-04-25",
    kennelTags: ["chain-gang-hhh"],
    runNumber: 40,
    title: "ANNUAL GENERAL MEEING: Chain Gang Hash House Harriers Trail #40",
    startTime: "13:00",
    sourceUrl: "https://www.meetup.com/richmond-hash-house-harriers/",
  },
];

async function main() {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);

  for (const ev of TRAIL_40) {
    console.log(
      `  ${ev.date} #${ev.runNumber} | ${ev.title} | start=${ev.startTime}`,
    );
  }

  if (!apply) {
    console.log("\nDry run complete. Re-run with BACKFILL_APPLY=1 to write to DB.");
    return;
  }

  try {
    const sources = await prisma.source.findMany({
      where: { name: SOURCE_NAME },
      select: { id: true },
    });
    if (sources.length === 0) throw new Error(`Source "${SOURCE_NAME}" not found in DB.`);
    if (sources.length > 1) {
      throw new Error(
        `Multiple sources named "${SOURCE_NAME}" found (${sources.length}). Aborting.`,
      );
    }

    console.log("\nDelegating to merge pipeline...");
    const merge = await processRawEvents(sources[0].id, TRAIL_40);
    console.log(
      `Done. created=${merge.created} updated=${merge.updated} skipped=${merge.skipped} ` +
        `unmatched=${merge.unmatched.length} blocked=${merge.blocked} errors=${merge.eventErrors}`,
    );
    if (merge.unmatched.length > 0) console.log(`  Unmatched tags: ${merge.unmatched.join(", ")}`);
    if (merge.blocked > 0) console.log(`  Blocked tags: ${merge.blockedTags.join(", ")}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
