/**
 * One-shot geocode backfill for issue #1256 — CH4 (Copenhagen Howling H3).
 *
 * CH4 run #372 lists "Køge station" as the venue. The ch4-dk adapter extracts
 * it correctly, but the canonical Event has NULL lat/lng, so the map renders
 * the Copenhagen *region-centroid fallback* (~36 km north of Køge). The
 * geocoder itself is correct — `geocodeAddress("Køge station")` resolves to
 * Køge (55.458, 12.186) with and without a region bias (verified 2026-06-08).
 * This is a coordinate-coverage gap, not a geocoder bug, so the fix is data,
 * not code: geocode the CH4-dk events that have a venue but no coords.
 *
 * Self-verifying / safe:
 *   - Targets only ch4-dk events with a non-empty locationName and NULL coords.
 *   - Validates the geocode lands within ~200 km of the Copenhagen kennel
 *     centroid before writing (rejects a wild result, fail-loud).
 *   - Per-event try/catch so one bad geocode/update doesn't abort the batch.
 *   - Idempotent: once coords are written the row no longer matches.
 *
 * Run (Railway proxy uses a self-signed cert):
 *   Dry-run: set -a && source .env && set +a && BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-ch4dk-geocode-1256.ts
 *   Apply:   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-ch4dk-geocode-1256.ts --apply
 *   Env:     DATABASE_URL, GOOGLE_CALENDAR_API_KEY
 */
import { geocodeAddress, haversineDistance } from "@/lib/geo";
import { runOneShot, findKennelId } from "./lib/one-shot";

// Copenhagen kennel centroid — geocode results must land within this radius.
const KENNEL = { lat: 55.68, lng: 12.57 };
const MAX_KM = 200;

void runOneShot(async ({ prisma, apply }) => {
  const kennelId = await findKennelId(prisma, "ch4-dk");
  if (!kennelId) return;

  const events = await prisma.event.findMany({
    where: { kennelId, latitude: null, longitude: null, locationName: { not: null } },
    select: { id: true, runNumber: true, locationName: true, locationStreet: true },
    orderBy: { date: "asc" },
  });
  console.log(`Matched ${events.length} ch4-dk event(s) with a venue but no coords.`);
  if (events.length === 0) return;

  let written = 0;
  for (const e of events) {
    try {
      // Prefer the fuller street address when present, else the venue name.
      // The query guarantees locationName is non-null; `|| ""` keeps the type
      // `string` without a non-null assertion (geocodeAddress no-ops on "").
      const address = e.locationStreet || e.locationName || "";
      const geo = await geocodeAddress(address, { regionBias: "dk" });
      if (!geo) {
        console.log(`  #${e.runNumber} ${e.id}: geocode null for ${JSON.stringify(address)} — skipping.`);
        continue;
      }
      const dist = haversineDistance(geo.lat, geo.lng, KENNEL.lat, KENNEL.lng);
      const ok = dist <= MAX_KM;
      console.log(
        `  #${e.runNumber} ${JSON.stringify(address)} → ${geo.lat.toFixed(4)},${geo.lng.toFixed(4)} ` +
          `(${dist.toFixed(0)}km from CPH; ${geo.formattedAddress ?? ""})${ok ? "" : "  ⚠️ >200km — refusing"}`,
      );
      if (ok && apply) {
        await prisma.event.update({ where: { id: e.id }, data: { latitude: geo.lat, longitude: geo.lng } });
        written++;
      }
    } catch (err) {
      console.error(`  #${e.runNumber} ${e.id}: failed —`, err);
    }
  }
  if (apply) console.log(`\n✓ Wrote coords to ${written} event(s).`);
  else console.log("\nRun with --apply to commit changes.");
});
