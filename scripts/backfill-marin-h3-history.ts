/**
 * One-shot historical backfill for Marin H3 (#1614).
 *
 * Thin wrapper around the reusable SFH3 backfill helper. SFH3 exposes ~144
 * Marin H3 runs across 2002–2026 on its per-kennel filter (`?kennel=10`), but
 * the live `kennels=all` adapter only sees the current period bucket. The
 * shared helper walks every period bucket once and pipes the rows through
 * the merge pipeline. See scripts/lib/sfh3-backfill.ts for the full
 * explanation.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-marin-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-marin-h3-history.ts
 */

import { backfillSfh3Kennel } from "./lib/sfh3-backfill";

async function main(): Promise<void> {
  try {
    await backfillSfh3Kennel({
      sfh3KennelId: 10,
      kennelCode: "marinh3",
      sourceName: "SFH3 MultiHash HTML Hareline",
      expectedLabel: "Marin H3",
    });
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
}

void main();
