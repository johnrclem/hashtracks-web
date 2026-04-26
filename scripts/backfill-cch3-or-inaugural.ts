/**
 * One-shot backfill for Cherry City H3 (cch3-or) inaugural run.
 *
 * Per issue #926, the Oregon Hashing Calendar contains the kennel's first
 * trail ("Cherry City H3 #1 / OH3 # 1340", 2025-07-12) but its kennelPatterns
 * order routes the event to `oh3` first (the OH3 pattern fires before the
 * Cherry City pattern), so the inaugural never lands on the cch3-or kennel
 * page. The Cherry City-only calendar source has just 3 events and doesn't
 * include #1 either.
 *
 * Direct fix is in seed.ts (reorder kennelPatterns so Cherry City matches
 * first), out of scope for this WS. This script lands the event today by
 * inserting a single RawEvent with kennelTag override; the merge pipeline
 * resolves to cch3-or via kennelTag, sidestepping the routing bug.
 *
 * The shared backfill helper routes through `processRawEvents`, so the
 * canonical cch3-or Event is created in the same pass — important here
 * because the recurring scrape would fingerprint this event with
 * kennelTag="oh3" (the buggy pattern match), so it would never re-process
 * a stale orphan if we deferred the merge.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-cch3-or-inaugural.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-cch3-or-inaugural.ts
 */

import "dotenv/config";
import { reportAndApplyBackfill } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Oregon Hashing Calendar";
const KENNEL_TIMEZONE = "America/Los_Angeles";

const INAUGURAL_RUN: RawEventData[] = [
  {
    date: "2025-07-12",
    kennelTag: "cch3-or",
    runNumber: 1,
    title: "Cherry City H3 #1 / OH3 # 1340",
    location: "Keizer Rapids Park, 1900 Chemawa Rd N, Keizer, OR 97303, USA",
    startTime: "12:30",
  },
];

async function main() {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);

  await reportAndApplyBackfill({
    apply,
    sourceName: SOURCE_NAME,
    events: INAUGURAL_RUN,
    kennelTimezone: KENNEL_TIMEZONE,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
