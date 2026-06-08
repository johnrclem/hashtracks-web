/**
 * One-shot cleanup for issue #1259 — BOGS theme/CTA location leak.
 *
 * bogsruns.php column 3 is "location + theme". When the venue is TBA the cell
 * is just a day-name/theme (± a "Hare wanted" CTA), e.g. "T.B.A. World
 * Orienteering Day", "World Brain Day Hare wanted". These non-geocodable
 * strings leaked into locationName because they carry no UK postcode to
 * truncate at and don't match the exact-string omit patterns.
 *
 * The adapter fix in this PR (`locationRequiresPostcode` on the BOGS generic
 * config) drops no-postcode cells going forward. This script clears the
 * already-stored leaks: any bogs-h3 event whose locationName contains no UK
 * postcode has its location fields nulled (real BOGS venues always carry one).
 *
 * Re-runnable: once locationName is null/postcoded the row no longer matches.
 *
 * Run:
 *   Dry-run: set -a && source .env && set +a && BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/cleanup-bogs-location-leak-1259.ts
 *   Apply:   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/cleanup-bogs-location-leak-1259.ts --apply
 */
import { runOneShot, findKennelId } from "./lib/one-shot";

// Same shape as UK_POSTCODE_RE in generic.ts.
const UK_POSTCODE_RE = /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i;

runOneShot(async ({ prisma, apply }) => {
  const kennelId = await findKennelId(prisma, "bogs-h3");
  if (!kennelId) return;

  const events = await prisma.event.findMany({
    where: { kennelId, locationName: { not: null } },
    select: { id: true, runNumber: true, locationName: true },
    orderBy: { date: "asc" },
  });

  const leaks = events.filter((e) => e.locationName != null && !UK_POSTCODE_RE.test(e.locationName));
  console.log(`bogs-h3 events with a locationName: ${events.length}; non-postcode leaks: ${leaks.length}`);
  for (const e of leaks) {
    console.log(`  CLEAR  #${e.runNumber} ${e.id}  ${JSON.stringify(e.locationName)} → null`);
  }

  if (apply && leaks.length > 0) {
    await prisma.event.updateMany({
      where: { id: { in: leaks.map((e) => e.id) } },
      data: {
        locationName: null,
        locationStreet: null,
        locationAddress: null,
        locationCity: null,
        latitude: null,
        longitude: null,
      },
    });
    console.log(`\n✓ Cleared location on ${leaks.length} event(s).`);
  } else if (!apply) {
    console.log("\nRun with --apply to commit changes.");
  }
});
