/**
 * READ-ONLY audit (#2020 follow-up) — Fort Worth/DFW past-event map-pin accuracy.
 *
 * The map pin is driven by the stored Event lat/lng, not the city label. A
 * "wrong city" suffix can still be a correct pin (Google reverse-geocodes a
 * street to its actual incorporated municipality, which differs from the
 * street's postal city). This audit ignores the label and instead re-geocodes
 * each event's address (locationName) and compares the fresh result to the
 * stored coordinates — divergence is the real pin bug.
 *
 * Confidence gate: only trust a fresh geocode whose formatted address echoes the
 * same 5-digit zip the source address carries. Addresses that embed explicit
 * coordinates in their text are skipped (their stored pin came from the text and
 * is likely better than a geocode of prose).
 *
 * No writes. Run:
 *   set -a && source .env && set +a && BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/audit-dfw-pin-accuracy.ts
 *   Env: DATABASE_URL, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { geocodeAddress, haversineDistance } from "@/lib/geo";
import { normalizeStateZipTail } from "@/adapters/html-scraper/dfw-hash";

const KENNEL_CODES = ["dh3-tx", "duhhh", "noduhhh", "fwh3", "yakh3"];
const DIVERGENCE_KM = 1.0; // pins further than this from the geocode are suspect

const ZIP_RE = /\b(\d{5})(?:-\d{4})?\b/;
// Embedded decimal/DMS coordinates in the address text (≥3 fraction digits or a
// degree symbol) → the stored pin likely came from the text; don't second-guess it.
// Bounded quantifiers (no unbounded `\d{3,}`/`\d+`) keep this linear (Sonar S5852).
const EMBEDDED_COORDS_RE = /-?\d{1,3}\.\d{3,9}|\d{1,3}°/;

interface Row {
  runNumber: number | null;
  date: string;
  kennelCode: string;
  locationName: string;
  storedCity: string | null;
  storedLat: number;
  storedLng: number;
  freshLat: number;
  freshLng: number;
  distanceKm: number;
  zip: string | null;
  zipConfirmed: boolean;
  formattedAddress: string;
}

async function main() {
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
    console.log(`Auditing ${events.length} DFW events with coords + locationName…\n`);

    const flagged: Row[] = [];
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
      if (dist <= DIVERGENCE_KM) continue;
      const zip = ZIP_RE.exec(loc)?.[1] ?? null;
      const zipConfirmed = !!zip && (geo.formattedAddress ?? "").includes(zip);
      flagged.push({
        runNumber: e.runNumber,
        date: e.dateUtc?.toISOString().slice(0, 10) ?? "?",
        kennelCode: codeById.get(e.kennelId) ?? "?",
        locationName: loc,
        storedCity: e.locationCity,
        storedLat: e.latitude!, storedLng: e.longitude!,
        freshLat: geo.lat, freshLng: geo.lng,
        distanceKm: dist,
        zip, zipConfirmed,
        formattedAddress: geo.formattedAddress ?? "",
      });
    }

    flagged.sort((a, b) => b.distanceKm - a.distanceKm);
    const confident = flagged.filter((f) => f.zipConfirmed);
    const lowConfidence = flagged.filter((f) => !f.zipConfirmed);

    console.log(`Checked ${checked} | skipped (embedded coords) ${skippedEmbedded} | geocode failed ${geocodeFailed}`);
    console.log(`Flagged ${flagged.length} pins > ${DIVERGENCE_KM} km off (${confident.length} zip-confirmed, ${lowConfidence.length} low-confidence)\n`);

    console.log(`=== ZIP-CONFIRMED divergences (high confidence the stored pin is wrong) ===`);
    for (const f of confident) {
      console.log(`  ${f.kennelCode} #${f.runNumber ?? "?"} ${f.date} — ${f.distanceKm.toFixed(1)} km off`);
      console.log(`    addr:   ${JSON.stringify(f.locationName)} (city=${JSON.stringify(f.storedCity)})`);
      console.log(`    stored: ${f.storedLat.toFixed(5)},${f.storedLng.toFixed(5)}  →  fresh: ${f.freshLat.toFixed(5)},${f.freshLng.toFixed(5)}`);
      console.log(`    geocoded as: ${f.formattedAddress}`);
    }

    console.log(`\n=== LOW-CONFIDENCE divergences (zip not echoed — review manually, do NOT auto-fix) ===`);
    for (const f of lowConfidence.slice(0, 40)) {
      console.log(`  ${f.kennelCode} #${f.runNumber ?? "?"} ${f.date} — ${f.distanceKm.toFixed(1)} km — ${JSON.stringify(f.locationName)} → ${f.formattedAddress}`);
    }
    if (lowConfidence.length > 40) console.log(`  … (${lowConfidence.length - 40} more)`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
