/**
 * One-shot historical backfill for East Bay H3 (#1032).
 *
 * Thin wrapper around the reusable SFH3 backfill helper. See
 * scripts/lib/sfh3-backfill.ts for the full explanation.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-east-bay-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-east-bay-h3-history.ts
 */

import "dotenv/config";
import { backfillSfh3Kennel } from "./lib/sfh3-backfill";

async function main(): Promise<void> {
  try {
    await backfillSfh3Kennel({
      sfh3KennelId: 4,
      kennelCode: "ebh3",
      sourceName: "SFH3 MultiHash HTML Hareline",
      expectedLabel: "EBH3",
    });
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
}

void main();
