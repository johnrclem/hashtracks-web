/**
 * One-shot cleanup: clear the bled location off Munich H3 run #938 (#2157).
 *
 * Run #938 and #939 fall on the same date (2026-06-20). The hareline sheet
 * leaves #938's Location cell blank, but a pre-#1851 same-date conflation wrote
 * #939's venue ("Gerlaser Forsthaus, 95138 Bad Steben") onto #938's canonical.
 *
 * The adapter reads each row atomically (proven by the #2157 fixture in
 * google-sheets/adapter.test.ts) and the merge matcher now defers an ambiguous
 * same-sourceUrl, same-date group to runNumber disambiguation so this can't
 * recur — but a blank-location re-scrape PRESERVES the stale value (full-update
 * skips locationName when the incoming cell is blank), so this residual row must
 * be cleared once by hand.
 *
 * Targeted + idempotent: only an mh3-de run-#938 canonical whose locationName is
 * exactly the bled value is touched; a second run finds nothing.
 *
 * Usage:
 *   npx tsx scripts/clear-mh3-938-bled-location.ts            # dry run (default)
 *   npx tsx scripts/clear-mh3-938-bled-location.ts --apply    # apply changes
 *
 * Load env before running (tsx does not auto-load .env):
 *   set -a && source .env && set +a
 */
import { runOneShot } from "./lib/one-shot";

const BLED_LOCATION = "Gerlaser Forsthaus, 95138 Bad Steben";
const KENNEL_CODE = "mh3-de";
const RUN_NUMBER = 938;

void runOneShot(async ({ prisma, apply }) => {
  const kennel = await prisma.kennel.findUnique({
    where: { kennelCode: KENNEL_CODE },
    select: { id: true, shortName: true },
  });
  if (!kennel) {
    console.log(`Kennel "${KENNEL_CODE}" not found — nothing to do.`);
    return;
  }

  // Only the run-#938 canonical whose location is exactly the run-#939 venue.
  const affected = await prisma.event.findMany({
    where: {
      runNumber: RUN_NUMBER,
      locationName: BLED_LOCATION,
      eventKennels: { some: { kennelId: kennel.id } },
    },
    select: {
      id: true, date: true,
      locationName: true, locationCity: true,
    },
  });

  console.log(`Found ${affected.length} ${kennel.shortName} run-#${RUN_NUMBER} event(s) carrying the bled location.`);
  for (const e of affected) {
    console.log(`  • ${e.id} (${e.date.toISOString().slice(0, 10)}) location="${e.locationName}" city="${e.locationCity}"`);
  }
  if (affected.length === 0) {
    console.log("Nothing to clear (already clean).");
    return;
  }

  if (!apply) {
    console.log("\n(Dry run — re-run with --apply to clear locationName/city/address/coords.)");
    return;
  }

  const result = await prisma.event.updateMany({
    where: { id: { in: affected.map((e) => e.id) } },
    data: {
      locationName: null,
      locationCity: null,
      locationAddress: null,
      latitude: null,
      longitude: null,
    },
  });
  console.log(`\n✅ Cleared location fields on ${result.count} event(s).`);
});
