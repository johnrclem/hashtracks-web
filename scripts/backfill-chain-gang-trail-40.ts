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
 * Uses `insertRawEventsForSource` directly (not `reportAndApplyBackfill`)
 * because the event date may be today or future — the helper's past-only
 * date filter would skip it.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-chain-gang-trail-40.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-chain-gang-trail-40.ts
 */

import "dotenv/config";
import { insertRawEventsForSource } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Richmond H3 Meetup";

const TRAIL_40: RawEventData[] = [
  {
    date: "2026-04-25",
    kennelTag: "chain-gang-hhh",
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

  console.log("\nWriting to DB...");
  const { preExisting, inserted } = await insertRawEventsForSource(
    SOURCE_NAME,
    TRAIL_40,
  );
  console.log(`  Pre-existing: ${preExisting}. Inserted: ${inserted}.`);
  if (inserted > 0) {
    console.log(
      `\nDone. Trigger a scrape of "${SOURCE_NAME}" from the admin UI to merge the new RawEvent.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
