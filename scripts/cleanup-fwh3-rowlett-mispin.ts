/**
 * One-shot correction for issue #2020 — Fort Worth H3 run #1060.
 *
 * The canonical Event for run #1060 ("309 Maloney Court Euless Tx 76040",
 * ZIP 76040 = Euless) was stored with a wrong reverse-geocoded city
 * "Rowlett, TX" and Rowlett-area coordinates (~20 mi NE), so the map pin and
 * the displayed ", Rowlett, TX" suffix both pointed at the wrong DFW city. The
 * same venue on run #1031 reverse-geocoded correctly to Euless, confirming this
 * was a one-off geocoding fluke, not a systemic data problem.
 *
 * The adapter fix in this PR (`normalizeStateZipTail` in dfw-hash.ts) stops new
 * occurrences by emitting a clean ", ST ZIP" tail that the downstream
 * `suppressRedundantCity` / `getLocationDisplay` guards recognize. But run
 * #1060 is in the past and the DFW source is `upcomingOnly`, so it will never
 * be re-scraped — this script corrects the stored record in place.
 *
 * Self-verifying:
 *   - Binds to the precise signature (kennel fwh3, run #1060, city "Rowlett, …").
 *   - Re-geocodes the normalized address live and refuses to write unless the
 *     result lands in Euless (sanity box), so a geocoder drift fails loud
 *     rather than writing a new wrong pin.
 *   - Idempotent: once the city is no longer "Rowlett", the signature misses.
 *
 * Run (Railway proxy uses a self-signed cert):
 *   Dry-run: set -a && source .env && set +a && BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/cleanup-fwh3-rowlett-mispin.ts
 *   Apply:   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/cleanup-fwh3-rowlett-mispin.ts --apply
 *   Env:     DATABASE_URL, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { geocodeAddress } from "@/lib/geo";
import { normalizeStateZipTail } from "@/adapters/html-scraper/dfw-hash";

// Euless sanity box — the normalized address must geocode here, else bail.
const EULESS = { lat: 32.8337, lng: -97.075, tol: 0.05 };

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "✏️  APPLYING changes" : "🔍 DRY RUN — no changes will be made");

  const pool = createScriptPool();
  try {
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const kennel = await prisma.kennel.findUnique({
      where: { kennelCode: "fwh3" },
      select: { id: true },
    });
    if (!kennel) {
      console.log('Kennel "fwh3" not found — nothing to do.');
      return;
    }

    const events = await prisma.event.findMany({
      where: {
        kennelId: kennel.id,
        runNumber: 1060,
        locationCity: { startsWith: "Rowlett" },
      },
      select: { id: true, locationName: true, locationCity: true, latitude: true, longitude: true },
    });
    console.log(`Matched ${events.length} event(s).`);
    if (events.length === 0) {
      console.log("Nothing to correct (already fixed or signature changed).");
      return;
    }

    for (const e of events) {
      const normalized = normalizeStateZipTail(e.locationName ?? "");
      const geo = await geocodeAddress(normalized, { regionBias: "us" });
      if (!geo) {
        console.log(`  ${e.id}: geocode returned null — skipping (fail loud).`);
        continue;
      }
      const inBox =
        Math.abs(geo.lat - EULESS.lat) <= EULESS.tol &&
        Math.abs(geo.lng - EULESS.lng) <= EULESS.tol;
      console.log(`  ${e.id}`);
      console.log(`    locationName: ${JSON.stringify(e.locationName)} → ${JSON.stringify(normalized)}`);
      console.log(`    coords:       ${e.latitude},${e.longitude} → ${geo.lat},${geo.lng} (${geo.formattedAddress ?? ""})`);
      console.log(`    locationCity: ${JSON.stringify(e.locationCity)} → null`);
      if (!inBox) {
        console.log(`    ⚠️ geocode outside the Euless sanity box — refusing to write.`);
        continue;
      }
      if (apply) {
        await prisma.event.update({
          where: { id: e.id },
          // locationCity → null: the normalized address self-describes Euless, TX,
          // so getLocationDisplay renders it without appending any city.
          data: {
            locationName: normalized,
            latitude: geo.lat,
            longitude: geo.lng,
            locationCity: null,
          },
        });
        console.log(`    ✓ corrected.`);
      }
    }
    if (!apply) console.log("\nRun with --apply to commit changes.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
