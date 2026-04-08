/**
 * One-shot historical backfill for Agnews (#549).
 *
 * Thin wrapper around the reusable SFH3 backfill helper. See
 * scripts/lib/sfh3-backfill.ts for the full explanation. Future SFH3 kennel
 * audits: copy this file, change the three params.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-agnews-sfh3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-agnews-sfh3-history.ts
 */

import { backfillSfh3Kennel } from "./lib/sfh3-backfill";

async function main(): Promise<void> {
  try {
    await backfillSfh3Kennel({
      sfh3KennelId: 13,
      kennelCode: "agnews",
      sourceName: "SFH3 MultiHash HTML Hareline",
    });
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
}

void main();
