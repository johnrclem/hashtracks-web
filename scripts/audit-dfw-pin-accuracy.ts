/**
 * DFW map-pin accuracy audit + targeted correction (#2020 follow-up).
 *
 * The map pin is driven by the stored Event lat/lng, not the city label. A
 * "wrong city" suffix can still be a correct pin (Google reverse-geocodes a
 * street to its actual incorporated municipality, which differs from the
 * street's postal city). This tool ignores the label and re-geocodes each
 * event's address (locationName), comparing the fresh result to the stored
 * coordinates — divergence is the real pin bug.
 *
 * Default (no flag) = READ-ONLY report of every divergence, split into:
 *   - zip-confirmed (fresh formatted address echoes the source zip → right city),
 *   - low-confidence (zip not echoed → Google fell back to a centroid or the
 *     wrong place, e.g. "Lake Ray Roberts Greenbelt" → Greenbelt, MD; the STORED
 *     pin is usually the correct one here, so these are NEVER auto-corrected).
 *
 * --apply = correct ONLY the high-confidence subset, where Google resolved the
 * exact street address and the stored pin is meaningfully (but not wildly) off:
 *   1. MIN_DIVERGENCE_KM < distance < MAX_DIVERGENCE_KM,
 *   2. the source zip is echoed in the fresh formatted address, AND
 *   3. the source's leading street number is echoed too (exact-street match).
 * On a match it writes lat/lng + a suppressed locationCity; the address text is
 * left as-is (locationName is not a fingerprint input). Idempotent.
 *
 * Run:
 *   Report:  set -a && source .env && set +a && BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/audit-dfw-pin-accuracy.ts
 *   Apply:   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/audit-dfw-pin-accuracy.ts --apply
 *   Env:     DATABASE_URL, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { geocodeAddress, reverseGeocode, haversineDistance } from "@/lib/geo";
import { normalizeStateZipTail } from "@/adapters/html-scraper/dfw-hash";
import { suppressRedundantCity } from "@/pipeline/merge";

const KENNEL_CODES = ["dh3-tx", "duhhh", "noduhhh", "fwh3", "yakh3"];
const MIN_DIVERGENCE_KM = 1.0; // pins closer than this are accurate enough
const MAX_DIVERGENCE_KM = 15.0; // never relocate a pin further than this (bad-geocode guard)

const ZIP_RE = /\b(\d{5})(?:-\d{4})?\b/;
const LEADING_NUMBER_RE = /\b(\d{1,6})\b/; // first house/street number in the address
// Embedded decimal/DMS coordinates in the address text → the stored pin likely
// came from the text; don't second-guess it. Bounded quantifiers stay linear.
const EMBEDDED_COORDS_RE = /-?\d{1,3}\.\d{3,9}|\d{1,3}°/;

interface Divergence {
  eventId: string;
  label: string; // "kennel #run date"
  locationName: string;
  storedCity: string | null;
  storedLat: number;
  storedLng: number;
  freshLat: number;
  freshLng: number;
  distanceKm: number;
  formattedAddress: string;
  zipConfirmed: boolean;
  streetConfirmed: boolean;
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "✏️  APPLYING corrections (high-confidence subset only)" : "🔍 READ-ONLY report");

  const pool = createScriptPool();
  try {
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const kennels = await prisma.kennel.findMany({
      where: { kennelCode: { in: KENNEL_CODES } },
      select: { id: true, kennelCode: true },
    });
    const codeById = new Map(kennels.map((k) => [k.id, k.kennelCode]));

    const events = await prisma.event.findMany({
      where: {
        kennelId: { in: kennels.map((k) => k.id) },
        latitude: { not: null },
        longitude: { not: null },
        locationName: { not: null },
      },
      select: {
        id: true, kennelId: true, runNumber: true, dateUtc: true,
        locationName: true, locationCity: true, latitude: true, longitude: true,
      },
      orderBy: { dateUtc: "asc" },
    });

    const flagged: Divergence[] = [];
    let skippedEmbedded = 0;
    let geocodeFailed = 0;
    let checked = 0;

    for (const e of events) {
      const loc = e.locationName ?? "";
      if (EMBEDDED_COORDS_RE.test(loc)) { skippedEmbedded++; continue; }
      const normalized = normalizeStateZipTail(loc);
      const geo = await geocodeAddress(normalized, { regionBias: "us" });
      checked++;
      if (!geo) { geocodeFailed++; continue; }
      const dist = haversineDistance(e.latitude!, e.longitude!, geo.lat, geo.lng);
      if (dist <= MIN_DIVERGENCE_KM) continue;

      const fa = geo.formattedAddress ?? "";
      const zip = ZIP_RE.exec(loc)?.[1];
      const streetNo = LEADING_NUMBER_RE.exec(loc)?.[1];
      flagged.push({
        eventId: e.id,
        label: `${codeById.get(e.kennelId)} #${e.runNumber ?? "?"} ${e.dateUtc?.toISOString().slice(0, 10) ?? "?"}`,
        locationName: loc,
        storedCity: e.locationCity,
        storedLat: e.latitude!, storedLng: e.longitude!,
        freshLat: geo.lat, freshLng: geo.lng,
        distanceKm: dist,
        formattedAddress: fa,
        zipConfirmed: !!zip && fa.includes(zip),
        // Token-split (not RegExp(variable)) so the leading house number must
        // appear as a standalone numeric token in the fresh address.
        streetConfirmed: !!streetNo && fa.split(/\D+/).includes(streetNo),
      });
    }

    flagged.sort((a, b) => b.distanceKm - a.distanceKm);
    // Correctable = exact-street match within the sane relocation window.
    const correctable = flagged.filter(
      (f) => f.zipConfirmed && f.streetConfirmed && f.distanceKm < MAX_DIVERGENCE_KM,
    );
    const other = flagged.filter((f) => !correctable.includes(f));

    console.log(`\nChecked ${checked} | skipped (embedded coords) ${skippedEmbedded} | geocode failed ${geocodeFailed}`);
    console.log(`Flagged ${flagged.length} pins > ${MIN_DIVERGENCE_KM} km off — ${correctable.length} correctable, ${other.length} review-only\n`);

    console.log(`=== CORRECTABLE (exact street match; --apply re-geocodes these) ===`);
    for (const f of correctable) {
      const rawCity = await reverseGeocode(f.freshLat, f.freshLng);
      const newCity = suppressRedundantCity(normalizeStateZipTail(f.locationName), rawCity);
      console.log(`  ${f.label} — ${f.distanceKm.toFixed(1)} km off`);
      console.log(`    addr:   ${JSON.stringify(f.locationName)}`);
      console.log(`    coords: ${f.storedLat.toFixed(5)},${f.storedLng.toFixed(5)} → ${f.freshLat.toFixed(5)},${f.freshLng.toFixed(5)} (${f.formattedAddress})`);
      console.log(`    city:   ${JSON.stringify(f.storedCity)} → ${JSON.stringify(newCity)}`);
      if (apply) {
        await prisma.event.update({
          where: { id: f.eventId },
          data: { latitude: f.freshLat, longitude: f.freshLng, locationCity: newCity },
        });
        console.log(`    ✓ corrected.`);
      }
    }

    console.log(`\n=== REVIEW-ONLY (ambiguous or geocoder fell back — never auto-corrected) ===`);
    for (const f of other.slice(0, 40)) {
      console.log(`  ${f.label} — ${f.distanceKm.toFixed(1)} km — ${JSON.stringify(f.locationName)} → ${f.formattedAddress}`);
    }
    if (other.length > 40) console.log(`  … (${other.length - 40} more)`);

    if (!apply && correctable.length > 0) console.log(`\nRun with --apply to correct the ${correctable.length} exact-street match(es).`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
