/**
 * One-shot backfill for Colombo Harriettes (colombo-harriettes) Run #2223.
 *
 * The Colombo Harriettes site (hashcolombo.com) SSRs a single "Next run" block
 * and keeps no on-site archive, so the recurring ColomboHarriettesAdapter only
 * ever sees the current run. At onboarding the site was in its between-postings
 * placeholder state ("We will announce soon"), so the kennel page would be empty
 * until the committee posts the next Saturday and the first scrape after that
 * picks it up.
 *
 * This script seeds the one concrete recent run documented during onboarding —
 * Run #2223 (Sat 2026-06-20, KK's Crib, Ratmalana, 17:00) — so the page shows a
 * real run immediately. It is a PAST event, which is safe: the source carries
 * `config.upcomingOnly: true`, so reconcile clamps its cancellation window to
 * the future and never cancels this row. `title` is left undefined → merge
 * synthesizes "Colombo Harriettes Trail #2223". Coordinates are left to the
 * merge pipeline's geocoder (the documented sample's map embed coords weren't
 * captured; the street address resolves Ratmalana).
 *
 * Calls `processRawEvents` inline (like backfill-chain-gang-trail-40.ts) so the
 * RawEvent is promoted to a canonical Event now; it dedups by fingerprint, so
 * re-running is safe.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-colombo-harriettes-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-colombo-harriettes-history.ts
 */

import "dotenv/config";
import { prisma } from "@/lib/db";
import { processRawEvents } from "@/pipeline/merge";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Colombo Harriettes Website";

const HISTORY: RawEventData[] = [
  {
    date: "2026-06-20", // Saturday
    kennelTags: ["colombo-harriettes"],
    runNumber: 2223,
    // title undefined → merge synthesizes "Colombo Harriettes Trail #2223".
    startTime: "17:00",
    location: "KK's Crib",
    locationStreet: "No.5, 1st Cross Street, Kandawala Road, Ratmalana",
    sourceUrl: "https://hashcolombo.com/",
  },
];

async function main() {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);

  for (const ev of HISTORY) {
    console.log(`  ${ev.date} #${ev.runNumber} | ${ev.location} | start=${ev.startTime}`);
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
    if (sources.length === 0) throw new Error(`Source "${SOURCE_NAME}" not found in DB. Run prisma db seed first.`);
    if (sources.length > 1) {
      throw new Error(`Multiple sources named "${SOURCE_NAME}" found (${sources.length}). Aborting.`);
    }

    console.log("\nDelegating to merge pipeline...");
    const merge = await processRawEvents(sources[0].id, HISTORY);
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
